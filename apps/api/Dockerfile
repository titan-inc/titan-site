# syntax=docker/dockerfile:1

# API (NestJS + Prisma).
#
# O contexto de build e a RAIZ do monorepo, nao apps/api:
#
#   docker build -f apps/api/Dockerfile -t titan-api .
#
# O app depende de packages/shared, do pnpm-lock.yaml e do pnpm-workspace.yaml,
# que vivem acima de apps/api. Com o contexto em apps/api, nada disso entra e o
# install falha sem explicar o porque.

# Debian slim, nao Alpine. O Prisma carrega binario nativo, e a combinacao
# musl + OpenSSL do Alpine e a origem classica de "passa local, quebra no
# container". Os ~40MB a mais nao pagam o tempo de depurar isso.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# A imagem slim nao traz openssl, e sem ele o Prisma avisa que "failed to detect
# the libssl/openssl version" e cai num default chutado. Instalar e mais barato
# que descobrir em producao o que esse chute quebra.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# corepack respeita o campo `packageManager` da raiz, entao a versao do pnpm
# aqui e a mesma da maquina de quem desenvolve e a mesma do CI.
RUN corepack enable
WORKDIR /app


FROM base AS deps
# So os manifestos primeiro. Esta camada so invalida quando uma dependencia
# muda — editar codigo nao refaz o install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# O `postinstall` do api roda `prisma generate`, que precisa do schema e da
# config em maos ANTES do install.
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/

# `prisma generate` nao conecta em banco nenhum, mas exige a variavel definida.
# Valor descartavel: nunca e usado para abrir conexao, e nao vai para a imagem
# final. A URL real vem do ambiente em runtime.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV DATABASE_URL=$DATABASE_URL

# `--filter api...` instala so a API e o que ela depende dentro do workspace.
# Sem o filtro, a imagem da API baixaria Next, React e o resto do front.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter api...


FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

# O shared antes da API, nesta ordem: o Nest compila contra o `dist` do shared,
# nao contra o TypeScript cru. E a mesma razao de o CI rodar build antes de
# typecheck (ver o fluxo de git no CLAUDE.md).
RUN pnpm --filter @titan/shared build && pnpm --filter api build

# `pnpm deploy` monta em /out uma arvore autocontida: a API, o shared ja
# compilado e as dependencias de producao, sem os symlinks da store do pnpm —
# que nao sobreviveriam a um COPY entre estagios.
#
# `--legacy` porque o pnpm 10 passou a exigir `inject-workspace-packages=true`
# para o deploy padrao. Nao adotamos essa opcao de proposito: ela troca o
# symlink de packages/shared por copia, e ai o watch do `pnpm dev` para de
# propagar mudanca do shared para os apps — o fluxo que o CLAUDE.md descreve.
# A flag mantem o efeito antigo aqui dentro, sem mexer no desenvolvimento.
RUN pnpm --filter api --prod deploy --legacy /out

# `prisma generate` de novo, agora DENTRO de /out.
#
# O generate do install escreveu o client em `.prisma/client` la na store do
# pnpm, e o deploy monta uma arvore nova que nao carrega esse artefato gerado.
# Sem este passo a imagem builda normalmente e o container morre no boot com
# "Cannot find module '.prisma/client/default'" — erro que nao menciona Docker
# nem deploy, e manda procurar no lugar errado.
#
# O binario direto, e nao `pnpm exec`: fora de um workspace o pnpm dispara uma
# checagem de dependencias e tenta reinstalar, e ai quebra em
# "@titan/shared@workspace:* ... no package named @titan/shared in the
# workspace" — o `workspace:*` do package.json nao tem mais workspace ao redor.
RUN cd /out && ./node_modules/.bin/prisma generate


FROM base AS runner
ENV NODE_ENV=production
# `API_PORT` e lido pelo main.ts; manter o default explicito evita descobrir
# em producao que a porta publicada nao e a que o processo escuta.
ENV API_PORT=3001
WORKDIR /app

COPY --from=build --chown=node:node /out ./

# `node` ja existe na imagem oficial. Rodar como root e desnecessario aqui: o
# processo nao escreve em lugar nenhum do filesystem.
USER node

EXPOSE 3001

# O endpoint existe desde o HealthModule e nao toca o banco, entao responde
# mesmo com o Postgres fora — que e o que se quer de um healthcheck de
# processo. `node --eval` para nao instalar curl so por causa disto.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node --eval "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# As migrations NAO rodam aqui. Container que migra sozinho no boot vira corrida
# quando sobem duas replicas, e o passo mais destrutivo do deploy fica escondido
# dentro do start. O comando de release e:
#
#   ./node_modules/.bin/prisma migrate deploy
#
# Funciona nesta imagem porque `prisma` e `dotenv` sao dependencias de PRODUCAO
# da API justamente para isto. Chamar pelo caminho do binario, nunca por
# `pnpm exec` — fora de um workspace o pnpm tenta reinstalar e falha.
CMD ["node", "dist/main"]
