# syntax=docker/dockerfile:1

# Web (Next 16).
#
# Contexto de build e a RAIZ do monorepo, igual ao da API:
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://seudominio.com/api \
#     -t titan-web .
#
# ATENCAO ao build-arg acima. `NEXT_PUBLIC_*` e inlinado no bundle do browser
# durante o `next build`, nao lido em runtime — entao esta imagem fica amarrada
# a uma URL de API. Trocar de ambiente exige REBUILD, nao so trocar variavel.
# Subir a imagem de staging em producao aponta o browser para a API errada, e
# a unica pista e um CORS quebrado no console de quem acessa.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app


FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter web...


FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# Ver o aviso do topo: isto entra no JavaScript que roda no browser.
# O default local existe so para `docker build` sem argumento nao produzir uma
# imagem que aponta para lugar nenhum.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Desliga a telemetria: build de CI nao deveria falar com terceiro.
ENV NEXT_TELEMETRY_DISABLED=1

# O shared compilado antes do Next, pelo mesmo motivo da API.
# O `prebuild` do web roda junto e gera o manifesto de imagens do roster a
# partir de apps/web/public/roster — por isso `/scripts` do .dockerignore e
# ancorado na raiz e nao pega o scripts/ do web.
RUN pnpm --filter @titan/shared build && pnpm --filter web build


FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# O server.js do standalone le PORT e HOSTNAME. Sem HOSTNAME=0.0.0.0 ele
# escuta so em localhost DENTRO do container, e nenhuma requisicao entra.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# O standalone preserva a estrutura do monorepo por causa do
# `outputFileTracingRoot`, entao o servidor sai em apps/web/server.js e os
# node_modules na raiz de /app.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./

# `static` e `public` NAO entram no standalone: o Next assume que um CDN os
# serve. Sem estas duas linhas a pagina sobe sem CSS e sem imagem — 200 no
# HTML e 404 em tudo que ele referencia.
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node --eval "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
