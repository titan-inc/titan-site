#!/usr/bin/env bash
set -euo pipefail

# Backup do Postgres de produção pro S3.
#
# Roda NA INSTÂNCIA (usa o docker compose e o aws cli do host, não de dentro
# de um container). Agendado via cron — ver TIT-97.
#
# Carrega o .env de produção sozinho, pra o crontab poder chamar este script
# direto sem nenhum setup de ambiente por fora.
ENV_FILE="/opt/titan-site/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# O .env guarda a credencial com nome ESCOPADO (BACKUP_AWS_*), de propósito:
# é a chave restrita do titan-site-backup-bot (TIT-89), só com acesso a este
# bucket. Nomear como AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY genérico faria
# parecer uma credencial ampla, e confundiria com uma futura chave AWS de
# outro propósito. O aws CLI só reconhece o nome genérico, então a ponte
# acontece aqui, explicitamente, e só neste processo.
export AWS_ACCESS_KEY_ID="$BACKUP_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_AWS_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$BACKUP_AWS_REGION"

COMPOSE_FILE="/opt/titan-site/docker-compose.prod.yml"
TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
ARQUIVO="titan-${TIMESTAMP}.sql.gz"
DESTINO_TMP="/tmp/${ARQUIVO}"

echo "[backup] iniciando dump de ${POSTGRES_DB} às ${TIMESTAMP}"

# -T: sem pseudo-tty. Com tty alocado, o docker intercala caractere de
# controle no meio do stream binário do pg_dump e o .gz sai corrompido.
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip >"$DESTINO_TMP"

# Dump vazio não é backup — é sinal de que algo falhou ANTES do pg_dump
# rodar (banco fora do ar, credencial errada). Falha alta em vez de subir
# um "backup" de poucos bytes que só é notado quando alguém precisar
# restaurar (ver TIT-99).
TAMANHO=$(stat -c%s "$DESTINO_TMP" 2>/dev/null || stat -f%z "$DESTINO_TMP")
if [ "$TAMANHO" -lt 1024 ]; then
  echo "[backup] ERRO: dump suspeito de vazio (${TAMANHO} bytes) — abortando sem subir pro S3" >&2
  rm -f "$DESTINO_TMP"
  exit 1
fi

aws s3 cp "$DESTINO_TMP" "s3://${BACKUP_S3_BUCKET}/${ARQUIVO}"
rm -f "$DESTINO_TMP"

echo "[backup] concluído: s3://${BACKUP_S3_BUCKET}/${ARQUIVO} (${TAMANHO} bytes)"