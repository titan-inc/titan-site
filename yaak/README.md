# Collection Yaak — Titan Site API

Collection do [Yaak](https://yaak.app) pra testar os endpoints da API (Nest)
manualmente. Compartilhada entre os três devs e sincronizada com este
diretório via Local Directory/Git Sync — ver TIT-123.

## Abrir

No app Yaak: **Open Workspace** → aponte para esta pasta (`yaak/` na raiz do
repo). O workspace "Titan Site API" e todas as pastas/requests aparecem.

Se preferir o CLI (`npm install -g @yaakapp/cli`, depois `yaak agent
install` pra instalar a skill de agente), ele lê e escreve na mesma base
local do app — o que um faz aparece no outro.

## Environments — por que duas, e por que uma não vai pro git

O workspace tem duas environments, e a separação existe por causa da Regra
de segredos do `CLAUDE.md`: **este repositório é público**.

- **`Team`** — a environment base do workspace, marcada `public` (o que o
  Yaak chama de "sharable"). É a única que sincroniza pro git. Só guarda
  `base_url` com valor real (`http://localhost:3001`, não é segredo) e os
  **nomes** das variáveis sensíveis, vazias, pra documentar que elas
  existem.
- **`Local`** — sub-environment, filha de `Team`, **não marcada `public`**.
  Nunca sincroniza. Cada dev preenche localmente:
  - `session_cookie` — valor de `titan_session` depois de logar no site
    local (copiar do DevTools, aba Application/Cookies).
  - `ops_token` — o `OPS_TRIGGER_TOKEN` do seu `.env` da API.

Pra usar valor real, selecione `Local` no seletor de environment antes de
enviar (`-e ev_...` no CLI) — ela sobrescreve `session_cookie` e
`ops_token` de `Team` por herança.

**Nunca marque `Local` como `public`/sharable.** Se isso acontecer por
engano, o valor vai para o próximo commit — trate como o mesmo incidente
que vazar um `.env` (ver seção Segredos do `CLAUDE.md`: rotacionar na
origem, não só reescrever o histórico).

## O que não é enviável

- `auth/Iniciar login (Battle.net)` e `auth/Callback (Battle.net)` — fluxo
  de redirect de browser contra o consent da Blizzard. Ficam documentadas
  pra referência de rota, mas `yaak send` não completa esse fluxo.
- `internal/ops/Catalog load` e `internal/ops/Loot import RC` — corpo é um
  arquivo grande (catálogo gerado, ou export do RCLootCouncil). O body vem
  com `{}` de placeholder; colar o JSON real antes de enviar.

## Rotas de `internal/ops/*`

Autorizadas por `X-Ops-Token` (`OpsTokenGuard`), não por cookie de sessão —
é o mesmo ator de `docs/ops.md` (automação/CLI, não pessoa). Em produção
essas rotas são bloqueadas no domínio público pelo Caddy; só alcançáveis
localmente ou por túnel SSH.
