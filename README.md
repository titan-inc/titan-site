# Site da Guilda

Landing pública com formulário de apply + área interna para guild management.

Planejamento: projeto **Site da Guilda** no Linear (time `TIT`).
Convenções de arquitetura e fluxo de git: [`CLAUDE.md`](./CLAUDE.md).

> Repositório **público**. Nenhuma credencial ou dado de membro pode ser versionado —
> ver a seção de segredos no `CLAUDE.md`.

## Stack

- **Front:** Next.js 16 (App Router) + React 19 + Tailwind 4
- **Back:** NestJS 11 + Prisma
- **Banco:** PostgreSQL
- **Compartilhado:** `packages/shared` — tipos e schemas Zod usados pelos dois lados
- **Auth:** Battle.net OAuth2

## Subindo o ambiente

Requer Node 22+, pnpm 11+ e Docker.

```bash
pnpm install
cp .env.example .env    # preencher os valores
pnpm db:up              # sobe o Postgres
pnpm migrate            # aplica as migrations
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:3001
- Postgres: localhost:5432

`pnpm dev` compila o `packages/shared` e sobe web, api e o watch do shared juntos.

### Banco

| Comando          | O que faz                              |
| ---------------- | -------------------------------------- |
| `pnpm db:up`     | sobe o Postgres e espera ficar healthy |
| `pnpm db:down`   | para o container, mantendo os dados    |
| `pnpm db:reset`  | **apaga** os dados e recria vazio      |
| `pnpm db:status` | mostra o estado de tudo                |
| `pnpm db:logs`   | acompanha o log do Postgres            |
| `pnpm db:psql`   | abre um psql interativo                |
| `pnpm migrate`   | aplica migrations pendentes            |

### Nota para quem usa Docker Desktop ou Linux

Os comandos `db:*` são específicos de **Docker dentro do WSL2 sem Docker Desktop**,
que é o setup de uma das máquinas. Eles resolvem uma armadilha desse cenário: o WSL
encerra a distro quando nenhum processo do Windows está preso a ela, o Docker para, e
o Postgres cai — o Prisma então falha com `P1001` sem nada ter crashado. O script
mantém um processo `wsl.exe` vivo para evitar isso.

Se você tem Docker Desktop, Docker nativo no Linux, ou Colima no Mac, ignore os
scripts e use direto:

```bash
docker compose up -d
```

O `docker-compose.yml` é portável; só o wrapper é que não é.

## Estado atual

Scaffold pronto e verificado: os três workspaces buildam, `pnpm typecheck` passa, e o
`packages/shared` foi confirmado consumível dos dois lados (ESM no Next, CJS no Nest).

Banco e Prisma funcionando: Postgres 18 em container, migration inicial aplicada com
os modelos `User` e `Session`, e o Nest conectando via driver adapter.

**Ainda não configurado:**

- Fluxo de login Battle.net — TIT-18. As credenciais já existem; falta o código.
- ESLint compartilhado na raiz — TIT-9. Hoje cada app usa a config do seu scaffold.

## Comandos

| Comando          | O que faz                              |
| ---------------- | -------------------------------------- |
| `pnpm dev`       | shared (watch) + web + api             |
| `pnpm dev:web`   | só o Next                              |
| `pnpm dev:api`   | só o Nest                              |
| `pnpm typecheck` | todos os workspaces                    |
| `pnpm build`     | build de tudo, na ordem de dependência |
| `pnpm lint`      | ESLint                                 |
| `pnpm test`      | testes                                 |
| `pnpm format`    | Prettier                               |

### Sonda de roster

Testa a lógica de membership **sem credencial da Blizzard e sem o login implementado**,
contra a api já rodando (`pnpm dev`):

```bash
curl "http://localhost:3001/internal/ops/roster-probe?guild=<Nome da Guilda>&realm=<realm>&characters=<personagem1,personagem2>" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"
```

Mostra o roster, a distribuição de rank (que vira role no site) e se a interseção por
slug encontra os personagens informados. Usa Raider.IO, que é público.

O Raider.IO é crawleado, então pode estar atrasado em relação ao jogo — a fonte da
verdade em produção é a Game Data API da Blizzard (TIT-19). Isto é ferramenta de dev.

Essa e as outras rotas de operação (`/internal/ops/*` — snapshot, sync de presença,
geração e carga de catálogo, checagem de credencial OAuth) rodam contra a app já
rodando, nunca sobem uma instância própria — ver `docs/ops.md` pra lista completa e
por quê (TIT-109).
