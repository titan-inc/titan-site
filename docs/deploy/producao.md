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

## `.env` de produção — variáveis

Mesma lista do `.env.example`, com estas diferenças:

| Variável                | Diferença em produção                                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | **Não setar.** Fica sem efeito — o `docker-compose.prod.yml` sintetiza a URL a partir de `POSTGRES_USER/PASSWORD/DB`.                                                                                 |
| `POSTGRES_USER`         | Novo em produção (o compose de dev hardcoda `titan`). Só existe aqui.                                                                                                                                 |
| `POSTGRES_PASSWORD`     | Novo em produção. Senha forte, gerada — não reusar a de dev (`titan`).                                                                                                                                |
| `POSTGRES_DB`           | Novo em produção. Pode ser `titan` mesmo, não é segredo.                                                                                                                                              |
| `BLIZZARD_REDIRECT_URI` | Domínio de produção + path `/api` (ver Caddyfile): `https://titaninc.com.br/api/auth/battlenet/callback`. Precisa estar cadastrado assim, byte a byte, no portal da Blizzard antes do primeiro login. |
| `WEB_URL`               | `https://titaninc.com.br`                                                                                                                                                                             |
| `NEXT_PUBLIC_API_URL`   | **Não é lido daqui.** Inlinado no bundle do Next durante o build — vem do build-arg que o CI passa (TIT-100/101), não do `.env` da instância. Editar aqui e reiniciar o container não muda nada.      |
| `SESSION_SECRET`        | Gerar um novo, não reusar o de dev.                                                                                                                                                                   |

Todo o resto (`BLIZZARD_CLIENT_ID/SECRET`, `GUILD_*`, `DISCORD_APPLY_WEBHOOK_URL`,
`WOW_AUDIT_KEY`, `WARCRAFTLOGS_*`, `API_PORT`) segue o mesmo significado do
`.env.example` — só troca o valor real pelo de produção.

## Credencial do backup (S3)

O usuário de serviço `titan-site-backup-bot` (TIT-89) tem Access Key ID e
Secret Access Key próprios, restritos ao bucket `titan-site-db-backups`.
Essas duas entram no `.env` da instância quando o script de backup (TIT-96)
existir — documentado ali, não aqui, porque é quem consome que define o
nome da variável.

## Rodando migration depois de um deploy

O container da api **não** roda migration no boot (ver comentário no
`apps/api/Dockerfile`). Depois de subir uma versão nova:

```bash
cd /opt/titan-site
docker compose -f docker-compose.prod.yml exec api ./node_modules/.bin/prisma migrate deploy
```
