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

## Environments — por que três, e por que só uma vai pro git

O workspace tem três environments, e a separação existe por causa da Regra
de segredos do `CLAUDE.md`: **este repositório é público**.

- **`Team`** — a environment base do workspace, marcada `public` (o que o
  Yaak chama de "sharable"). É a única que sincroniza pro git. Só guarda
  `base_url` com valor real (`http://localhost:3001`, não é segredo) e os
  **nomes** das variáveis sensíveis, vazias, pra documentar que elas
  existem.
- **`Local`** — sub-environment, filha de `Team`, **não marcada `public`**.
  Nunca sincroniza. Cada dev preenche localmente, contra a API rodando na
  própria máquina:
  - `session_cookie` — valor de `titan_session` depois de logar no site
    local (copiar do DevTools, aba Application/Cookies).
  - `ops_token` — o `OPS_TRIGGER_TOKEN` do seu `.env` da API.
  - `catalog_dump_path` — caminho absoluto, na sua máquina, de um arquivo
    `.json` com a colagem do `/tilc journal` do addon já escapada como
    string JSON. Gere com `pnpm dump:escape dump.txt` (grava `dump.json` ao
    lado — ver `docs/ops.md`, seção "Catálogo — gerar"), **nunca aponte pro
    `.txt` cru**: testado em 15/08/2026, `json.escape()` não funciona na
    versão atual da CLI do Yaak (devolve o texto sem escapar, sem erro
    nenhum), então colar o dump cru aqui quebra o JSON do corpo em silêncio.
    Usado pelo request `internal/ops/Catalog generate` via
    `${[ fs.readFile(path=catalog_dump_path) ]}`. Não é segredo — é
    declarado do mesmo jeito (nome vazio em `Team`, valor em `Local`) só
    porque o caminho é específico da sua máquina, não porque precisa ficar
    escondido.
  - `catalog_json_path` — caminho absoluto, na sua máquina, do `.json` de
    um catálogo já gerado (ex.: `apps/api/catalogo/the-voidspire.json`, ou
    a saída salva de `internal/ops/Catalog generate`). Usado pelo request
    `internal/ops/Catalog load` via
    `${[ fs.readFile(path=catalog_json_path) ]}`. Mais simples que o
    `journalDump` do `Catalog generate`: `catalog` no corpo é um **valor
    JSON** (objeto), não uma string, então `fs.readFile()` sozinho já
    produz JSON válido — sem precisar de `pnpm dump:escape` nem de nenhum
    outro tratamento.
  - `bonus_dictionary_path` — caminho absoluto, na sua máquina, do `.json`
    do dicionário de bonus IDs (TIT-82) — ver "Dicionário de bonus IDs —
    carregar" em `docs/ops.md` para como montar o arquivo. Usado pelo
    request `internal/ops/Bonus load` via
    `${[ fs.readFile(path=bonus_dictionary_path) ]}`. Mesmo caso do
    `catalog_json_path`: `dictionary` no corpo é um valor JSON, sem
    precisar de `pnpm dump:escape`.
- **`Prod`** — sub-environment irmã de `Local`, também **não marcada
  `public`**. Contra produção, por túnel SSH — nunca direto: o Caddy
  bloqueia `/internal/ops/*` no domínio público, e o resto da área interna
  exige sessão de verdade de qualquer forma. `base_url` aponta pro túnel
  local (`http://localhost:3002` — de propósito **diferente** da porta
  3001 da API local, pra `Local` e `Prod` nunca apontarem pro mesmo lugar
  por acidente de porta). `session_cookie`/`ops_token` vazios, cada dev
  preenche com o valor **de produção**.

Pra usar valor real, selecione a sub-environment (`Local` ou `Prod`) no
seletor antes de enviar (`-e ev_...` no CLI) — ela sobrescreve
`base_url`/`session_cookie`/`ops_token` de `Team` por herança.

**`Prod` é destacada em vermelho no seletor do Yaak** de propósito. As
rotas de `internal/ops/*` **escrevem** no banco (snapshot,
attendance-sync, catalog-load...) — mandar uma dessas achando que está em
`Local` quando na verdade é `Prod` selecionada não é um teste ruim, é
grava dado real errado. Confira a environment ativa antes de enviar
qualquer coisa em `ops/`.

**Nunca marque `Local` ou `Prod` como `public`/sharable.** Se isso
acontecer por engano, o valor vai para o próximo commit — trate como o
mesmo incidente que vazar um `.env` (ver seção Segredos do `CLAUDE.md`:
rotacionar na origem, não só reescrever o histórico). Vale ainda mais para
`Prod`: o token e o cookie ali são os de produção de verdade.

## O que não é enviável

- `auth/Iniciar login (Battle.net)` e `auth/Callback (Battle.net)` — fluxo
  de redirect de browser contra o consent da Blizzard. Ficam documentadas
  pra referência de rota, mas `yaak send` não completa esse fluxo.
- `internal/ops/Loot import RC` — corpo é o export do RCLootCouncil, um
  arquivo grande. O body vem com `{}` de placeholder; colar o JSON real
  antes de enviar.

## Rotas de `internal/ops/*`

Autorizadas por `X-Ops-Token` (`OpsTokenGuard`), não por cookie de sessão —
é o mesmo ator de `docs/ops.md` (automação/CLI, não pessoa). Em produção
essas rotas são bloqueadas no domínio público pelo Caddy; só alcançáveis
localmente ou por túnel SSH.
