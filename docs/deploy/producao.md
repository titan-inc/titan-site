# Deploy em produção

Referência operacional pra quem for mexer no ambiente de produção (Lightsail).
Nenhum valor real vive aqui — só nomes de variável e convenções. Ver
`.env.example` na raiz pra comentário completo de cada chave da aplicação.

## Onde tudo mora na instância

```
/opt/titan-site/
├─ docker-compose.prod.yml
├─ Caddyfile
└─ .env
```

`docker-compose.prod.yml` e `Caddyfile` chegam ali via deploy (cópia pelo
job de CI/CD, TIT-103) — não são editados à mão na instância, mudam pelo
repositório e um novo deploy. `.env` é a exceção: existe só na instância,
nunca é commitado, e é editado à mão via SSH quando precisa mudar.

## O que roda fora do Docker, direto no host

Três coisas instaladas manualmente na instância, fora do `docker-compose.prod.yml`
— nenhuma delas é reproduzida por deploy automático nem por TIT-106:

- **Swap de 1GB** (`/swapfile`, registrado em `/etc/fstab`) — a instância
  não vinha com swap nenhum. Rede de segurança contra pico passageiro de
  memória, não licença pra rodar processo pesado (TIT-110).
- **AWS CLI v2** — necessário pro script de backup (`aws s3 cp`). O pacote
  `awscli` do apt **não existe** no Ubuntu 24.04 (Noble); instalado via
  instalador oficial:
  ```bash
  curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
  sudo apt-get install -y unzip
  unzip awscliv2.zip
  sudo ./aws/install
  rm -rf awscliv2.zip aws
  ```
- **Node.js + `crontab-ui`** — dashboard web pro cron (ver "Comandos úteis"
  abaixo). Instalado nativo no host de propósito, não containerizado: containerizar
  exigiria dar ao container acesso ao `docker.sock` pra ele conseguir
  disparar `docker compose exec`, o que equivale a root sobre todos os
  outros containers (TIT-112).

## `.env` de produção — variáveis

Mesma lista do `.env.example`, com estas diferenças:

| Variável                | Diferença em produção                                                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | **Não setar.** Fica sem efeito — o `docker-compose.prod.yml` sintetiza a URL a partir de `POSTGRES_USER/PASSWORD/DB`.                                                                                     |
| `POSTGRES_USER`         | Novo em produção (o compose de dev hardcoda `titan`). Só existe aqui.                                                                                                                                     |
| `POSTGRES_PASSWORD`     | Novo em produção. Senha forte, gerada — não reusar a de dev (`titan`). **Gerar com `openssl rand -hex 24`, nunca `-base64`** (ver seção abaixo).                                                          |
| `POSTGRES_DB`           | Novo em produção. Pode ser `titan` mesmo, não é segredo.                                                                                                                                                  |
| `BLIZZARD_REDIRECT_URI` | Domínio de produção + path `/api` (ver Caddyfile): `https://titaninc.com.br/api/auth/battlenet/callback`. Precisa estar cadastrado assim, byte a byte, no portal da Blizzard antes do primeiro login.     |
| `WEB_URL`               | `https://titaninc.com.br`                                                                                                                                                                                 |
| `NEXT_PUBLIC_API_URL`   | **Não é lido daqui.** Inlinado no bundle do Next durante o build — vem do build-arg que o CI passa (TIT-100/101), não do `.env` da instância. Editar aqui e reiniciar o container não muda nada.          |
| `SESSION_SECRET`        | Gerar um novo, não reusar o de dev.                                                                                                                                                                       |
| `OPS_TRIGGER_TOKEN`     | Gerar um novo, não reusar o de dev. Protege `/internal/ops/*` (ver `docs/ops.md` e TIT-109) — além disso, bloqueada no domínio público pelo Caddy, só alcançável de dentro do container ou por túnel SSH. |

Todo o resto (`BLIZZARD_CLIENT_ID/SECRET`, `GUILD_*`, `DISCORD_APPLY_WEBHOOK_URL`,
`DISCORD_MPLUS_WEBHOOK_URL`, `DISCORD_MPLUS_ROLE_ID`, `WOW_AUDIT_KEY`,
`WARCRAFTLOGS_*`, `API_PORT`) segue o mesmo significado do `.env.example` — só
troca o valor real pelo de produção.

Um cuidado só, nos webhooks do Discord: são **dois canais diferentes** e a api
recusa subir se as duas URLs forem iguais. O de candidatura é o canal privado da
liderança; o de M+ é o `#míticas-pluses`, aberto à guilda. Apontar um para o
outro vaza dado pessoal de candidato para a guilda inteira.

## Gerando POSTGRES_PASSWORD (e qualquer segredo que vai dentro de uma URL)

**Sempre `openssl rand -hex N`, nunca `-base64`.** O `docker-compose.prod.yml`
monta o `DATABASE_URL` colando a senha direto na string
(`postgresql://user:senha@postgres:5432/db`), sem nenhum encode. Base64 pode
gerar `/`, `+` e `=` — todos caracteres especiais de URL — e se a senha cair
com uma `/` no meio, ela quebra o parser da connection string (`ERR_INVALID_URL`
do Prisma, sintoma real já visto em produção em 10/08/2026). Hex usa só
`0-9a-f`, sempre seguro:

```bash
openssl rand -hex 24
```

Se a senha do Postgres precisar trocar depois de o volume já existir, trocar
só o `.env` não basta — o `initdb` já gravou a senha antiga no volume.
Precisa recriar o volume junto (`docker compose down -v`, depois `up -d` de
novo), o que **apaga os dados**. Fora de um cenário de "banco ainda vazio",
trocar a senha do Postgres em produção é operação destrutiva.

## Backup (S3)

Variáveis `BACKUP_AWS_ACCESS_KEY_ID`, `BACKUP_AWS_SECRET_ACCESS_KEY`,
`BACKUP_AWS_REGION` e `BACKUP_S3_BUCKET` no `.env` da instância —
credencial do usuário de serviço `titan-site-backup-bot` (TIT-89),
restrita ao bucket `titan-site-db-backups`. Consumidas por
`scripts/deploy/backup-postgres-to-s3.sh`.

Nome escopado (`BACKUP_AWS_*`) de propósito, não o `AWS_ACCESS_KEY_ID`
genérico que o `aws` CLI reconhece sozinho — essa credencial só tem
permissão neste bucket, e uma futura chave AWS de outro escopo não deve
colidir com o nome desta.

### Testar um restore (backup nunca testado não é backup)

Validado em produção pela primeira vez em 11/08/2026 — 14 tabelas, dados
reais (`RaidAttendance` com 3198 linhas, batendo com o que o
`attendance-sync` já reportava). Roda periodicamente, não só na primeira
vez.

Tudo via SSH na instância, num Postgres **descartável** — nunca no banco
de produção:

```bash
# 1. Credenciais do backup-bot só existem dentro do .env, o `aws` cli
#    solto no terminal não acha sozinho.
set -a
source /opt/titan-site/.env
set +a
export AWS_ACCESS_KEY_ID="$BACKUP_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_AWS_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$BACKUP_AWS_REGION"

# 2. Backup mais recente
aws s3 ls s3://titan-site-db-backups/ | sort | tail -3
aws s3 cp s3://titan-site-db-backups/<arquivo-mais-novo>.sql.gz /tmp/restore-test.sql.gz
gunzip -k /tmp/restore-test.sql.gz

# 3. Postgres descartável -- mesma major version da produção
#    (postgres:18-alpine), pra não arriscar diferença de formato de dump.
#    Porta e nome diferentes do container real, de propósito.
docker run -d --name titan-restore-test \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test \
  -p 127.0.0.1:5555:5432 \
  postgres:18-alpine
sleep 5
docker exec titan-restore-test pg_isready -U test

# 4. Restaura e filtra os erros que IMPORTAM
cat /tmp/restore-test.sql | docker exec -i titan-restore-test psql -U test -d test > /tmp/restore-output.log 2>&1
grep -i "error" /tmp/restore-output.log | grep -v 'role "titan" does not exist'
```

O `grep` do passo 4 tem que voltar **vazio**. `ERROR: role "titan" does not
exist` é esperado e não é sinal de dump ruim — é o `pg_dump` incluindo
`ALTER TABLE ... OWNER TO titan` pra cada tabela (dono é `titan` em
produção; o container de teste só tem o usuário `test`). Só a troca de
dono falha; `CREATE TABLE` e os dados em si não dependem disso. Qualquer
**outro** tipo de erro nessa saída é sinal real de problema.

Confirma tabela e dado de verdade, não só estrutura vazia:

```bash
docker exec titan-restore-test psql -U test -d test -c "\dt"
docker exec titan-restore-test psql -U test -d test -c "
SELECT 'GuildCharacter' AS tabela, count(*) FROM \"GuildCharacter\"
UNION ALL SELECT 'User', count(*) FROM \"User\"
UNION ALL SELECT 'RaidAttendance', count(*) FROM \"RaidAttendance\";
"
```

Limpa tudo depois:

```bash
docker rm -f titan-restore-test
rm -f /tmp/restore-test.sql /tmp/restore-test.sql.gz /tmp/restore-output.log
```

## Primeiro acesso (uma vez por dev)

Todo comando da próxima seção começa dentro da instância, e chegar lá exige uma
chave SSH sua no `authorized_keys` do usuário `ubuntu`. São três passos, e
**nenhum depende de outro dev estar disponível** — o console da Lightsail é o
que quebra essa dependência.

O `<STATIC_IP>` é o IP estático da instância, o mesmo que o A record de
`titaninc.com.br` resolve (o Caddy roda na própria instância).

**1. Gerar o par de chaves.** `ssh` e `ssh-keygen` já vêm no Windows 11, não
precisa instalar nada:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/titan-site-<seu-nome> -C "<seu-email> titan-site"
```

Vai perguntar a passphrase — deixar em branco é aceitável (é o que a chave do
CI faz), mas aí quem copiar o arquivo entra em produção. Dá pra colocar depois
com `ssh-keygen -p -f ~/.ssh/titan-site-<seu-nome>`.

⚠️ No PowerShell, **não** passe `-N ""` pra pular a pergunta: ele grava uma
passphrase literal de dois caracteres e a chave fica inutilizável sem que nada
avise. Ou responde interativamente, ou passa uma variável vazia (`$v = ''`).

**2. Subir a pública pelo console da Lightsail.** Console AWS → Lightsail →
aba **Instances** → ícone de terminal no card da instância. Abre um SSH no
navegador já logado como `ubuntu`, **sem precisar de chave nenhuma** — é
exatamente por isso que este passo não precisa de outro dev. Lá dentro, colando
o conteúdo do seu `.pub` (o botão de colar é o ícone de clipboard no canto
inferior direito; `Ctrl+V` não funciona):

```bash
echo 'ssh-ed25519 AAAA... <seu-email> titan-site' >> ~/.ssh/authorized_keys
```

**3. Primeira conexão — `known_hosts`.** Máquina nova não tem o arquivo, então
o SSH quer perguntar se você confia neste host. Fora de um terminal interativo
ele não consegue perguntar e aborta com **`Host key verification failed`** —
mensagem que não sugere a causa e faz a pessoa procurar defeito na chave, que
está certa. Na primeira vez:

```bash
ssh -o StrictHostKeyChecking=accept-new -i ~/.ssh/titan-site-<seu-nome> ubuntu@<STATIC_IP>
```

Só na primeira; depois disso o host está gravado e o `ssh` normal funciona.
Pra conferir que gravou o host certo em vez de confiar cegamente, compare o
fingerprint com o que o console da Lightsail mostra:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub   # no console
ssh-keygen -lf ~/.ssh/known_hosts                  # na sua máquina
```

**Opcional, mas poupa digitação:** um `~/.ssh/config` na sua máquina troca
`-i ~/.ssh/... ubuntu@<STATIC_IP>` por `titan-prod` em todos os comandos
abaixo, inclusive nos túneis.

```
Host titan-prod
  HostName <STATIC_IP>
  User ubuntu
  IdentityFile ~/.ssh/titan-site-<seu-nome>
```

Se o teste falhar com `Permission denied (publickey)`, o `echo` do passo 2 não
chegou no arquivo certo. Se falhar com `UNPROTECTED PRIVATE KEY FILE`, é ACL do
Windows na chave privada — `icacls` restringindo o arquivo ao seu usuário
resolve.

## Comandos úteis

Todos assumem `cd /opt/titan-site` antes (onde vive o `docker-compose.prod.yml`),
via SSH:

```bash
ssh -i ~/.ssh/titan-site-<seu-nome> ubuntu@<STATIC_IP>
```

**Status dos containers:**

```bash
docker compose -f docker-compose.prod.yml ps
```

**Logs ao vivo** (`-f` de "follow"):

```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f web
docker compose -f docker-compose.prod.yml logs -f api web   # os dois juntos
docker compose -f docker-compose.prod.yml logs -f --tail=100 api   # com histórico recente
```

**Túnel SSH pro Postgres** — o banco não fica exposto na internet (só na
loopback `127.0.0.1` do host), então acesso direto de fora exige túnel.
Num terminal, abre e deixa aberto:

```bash
ssh -i ~/.ssh/titan-site-<seu-nome> -L 5433:127.0.0.1:5432 ubuntu@<STATIC_IP>
```

Com o túnel de pé, em outro terminal (ou num client gráfico como TablePlus/
DBeaver, apontando pra `localhost:5433`):

```bash
psql "postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:5433/$POSTGRES_DB"
```

(precisa do `psql` instalado na sua máquina — não vem por padrão no
Windows; um client gráfico dispensa isso.)

**Túnel SSH pro `crontab-ui`** — dashboard web do cron do usuário `ubuntu`,
rodando nativo no host (`systemctl status crontab-ui`), só na loopback:

```bash
ssh -i ~/.ssh/titan-site-<seu-nome> -L 8000:127.0.0.1:8000 ubuntu@<STATIC_IP>
```

Com o túnel de pé: **http://localhost:8000**.

⚠️ Depois de criar/editar um job na UI, precisa clicar em **"Save to crontab"**
— sem isso a mudança fica só no rascunho da UI e nunca vira cron de
verdade (não roda, mas também não avisa que não vai rodar).

Job cadastrado hoje: `backup-postgres`, `0 8 * * *` (5h BRT — o sistema
roda em UTC, confirmado com `timedatectl`), rodando
`scripts/deploy/backup-postgres-to-s3.sh >> /opt/titan-site/backup.log 2>&1`,
com "Enable error logging" ligado na UI pra falha ficar visível ali
também, não só no arquivo.

**Migration depois de um deploy** — o container da api **não** roda migration
no boot (ver comentário no `apps/api/Dockerfile`), é sempre passo manual:

```bash
docker compose -f docker-compose.prod.yml exec api ./node_modules/.bin/prisma migrate deploy
```

**Redeploy manual** (o mesmo que o job de CI faz sozinho — útil se quiser
forçar sem esperar um push, ou se o deploy automático falhar no meio):

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

**Recarregar o `.env`** depois de editar/adicionar uma variável — só isto,
sem `pull` nem `--force-recreate`:

```bash
docker compose -f docker-compose.prod.yml up -d
```

Confirmado na prática (não é suposição): o `docker compose up -d` calcula
o hash da config resolvida de cada serviço — `environment:` interpolado
**e** o conteúdo de `env_file:` entram nessa conta — e recria **só** quem
mudou. Editar uma variável que só a `api` lê recria a `api` e deixa `web`/
`postgres`/`caddy` intocados, sem downtime dos outros.

Exceção: `POSTGRES_USER`/`PASSWORD`/`DB` não seguem essa regra — o
Postgres só lê essas variáveis no `initdb`, na primeira vez que o volume é
criado. Depois disso, mudar o `.env` e rodar `up -d` recria o _container_
mas não muda a senha já gravada no banco. Ver "Reset completo do banco"
abaixo.

**Recriar um serviço do zero mesmo sem nada ter mudado** (container preso
num estado ruim, por exemplo):

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate api
```

**Reset completo do banco (DESTRUTIVO — apaga todos os dados)**, só depois
de confirmar que não tem nada de valor gravado. Necessário se o
`POSTGRES_PASSWORD` mudar depois que o volume já existe (ver seção acima):

```bash
docker compose -f docker-compose.prod.yml down -v
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec api ./node_modules/.bin/prisma migrate deploy
```

**Testar de fora** se o site e a api estão respondendo (rodar da sua
máquina, não da instância):

```bash
curl -sSI https://titaninc.com.br/
curl -sS https://titaninc.com.br/api/health
```
