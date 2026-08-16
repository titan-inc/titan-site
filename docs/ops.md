# Operações administrativas (`/internal/ops/*`)

Substituem os antigos `apps/api/scripts/*-probe.js` e `catalog-generate.js`/
`catalog-load.js` — ver TIT-109. Rodavam `NestFactory.createApplicationContext`
num processo à parte, dentro do mesmo container que já roda a app como
processo principal; numa instância de 1GB isso dobrava o consumo de memória
da api e já derrubou a instância inteira uma vez. As rotas abaixo fazem a
mesma coisa contra a app **já rodando**, sem esse custo.

Todas exigem o header `X-Ops-Token`, valor de `OPS_TRIGGER_TOKEN` no `.env`.
Em produção a rota inteira é bloqueada no domínio público pelo Caddy — só
alcançável de dentro do container (`docker compose exec`) ou por túnel SSH
(ver `docs/deploy/producao.md`).

Em dev local (`pnpm dev`), a base é `http://localhost:3001`.

Todas as rotas abaixo (e o resto da API) também estão prontas como requests
na collection do Yaak em `yaak/` — ver `yaak/README.md` — se preferir
testar por lá em vez de `curl`.

**Corpo até 2mb neste prefixo**, contra 16kb no resto da app (`main.ts`). As duas
rotas que carregam arquivo — `catalog-load` e `loot-import-rc` — não caberiam no
teto público: o maior catálogo tem 92 KB e o export do RC tem 304 KB. O teto
público existe para o `/applications`, que é anônimo; aqui não há ator anônimo,
mas o teto continua existindo contra engano de operador (`--data-binary @` com o
caminho errado), que é o modo de falha da TIT-109.

## Como implementar uma rota nova

Segue o mesmo desenho das sete que já existem — **nunca** chama
`NestFactory` de dentro de um método, é exatamente o padrão que este
módulo existe pra evitar (Regra 8 do CLAUDE.md).

1. **Reaproveita o service que já existe** pra aquela operação. Adiciona o
   método em `apps/api/src/ops/ops.controller.ts`, injetando o service
   certo no construtor — igual `snapshot`/`attendance-sync`/`catalog-*` já
   fazem. Nenhuma lógica de negócio nasce no controller.
2. **Se a lógica não existir em nenhum service ainda** (caso de
   `roster-probe`/`oauth-check`, que nunca tiveram um), entra em
   `apps/api/src/ops/ops.service.ts` — ou no service de domínio certo, se
   fizer sentido reaproveitar fora de ops também.
3. **Módulo novo sendo importado?** Adiciona em `imports` de
   `apps/api/src/ops/ops.module.ts`. Sem isso o Nest não injeta.
4. **Guard e bloqueio no Caddy já cobrem qualquer rota nova sob
   `/internal/ops/*` automaticamente** — o `@UseGuards(OpsTokenGuard)` está
   no `@Controller('internal/ops')` inteiro, e o bloco do Caddyfile usa
   `/api/internal/ops/*` (com `*`, não uma rota específica). Não precisa
   repetir o guard nem tocar no Caddyfile pra uma rota nova aqui dentro.
5. **Corpo grande/estruturado** → valida com `ZodValidationPipe` + schema
   do `@titan/shared` (Regra 2 do CLAUDE.md), igual `catalog-generate`/
   `catalog-load` fazem. **Query param simples** → parse manual, igual o
   resto do controller.
6. **Testa** em `ops.controller.spec.ts` (mocka os services, chama o
   método do controller direto — sem subir `TestingModule`, é o padrão já
   usado em todo o resto da api) e, se a lógica for nova, em
   `ops.service.spec.ts`.
7. **Documenta o `curl` equivalente** aqui embaixo, na seção certa.

Antes de criar uma rota nova, confere se já não existe um caminho — foi o
caso do `raid-probe.js`: a chamada já existia como `GET /internal/raid-progress`.
Ainda assim ganhou uma rota em `/internal/ops` (`raid-progress`, abaixo),
porque o valor aqui não é só "existir o dado" — é poder pedir via `curl`/CLI
sem precisar de cookie de sessão. Nem sempre vale a pena: se a rota que já
existe for suficiente pro uso real, documentar o `curl` com cookie de
sessão (como esta seção já fazia) pode ser a escolha mais simples.

## Snapshot semanal

Era `pnpm --filter api probe:snapshot [--backfill]`.

```bash
curl -X POST "http://localhost:3001/internal/ops/snapshot" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"

# com backfill das chaves de semanas passadas da season corrente:
curl -X POST "http://localhost:3001/internal/ops/snapshot?backfill=true" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"
```

## Sync de presença

Era `pnpm --filter api probe:attendance [--all|--dias N]`.

```bash
curl -X POST "http://localhost:3001/internal/ops/attendance-sync" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"                        # últimos 30 dias

curl -X POST "http://localhost:3001/internal/ops/attendance-sync?dias=90" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"

curl -X POST "http://localhost:3001/internal/ops/attendance-sync?all=true" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"                        # histórico inteiro
```

## Progressão de raid

Era `pnpm --filter api probe:raid [season]`.

```bash
curl "http://localhost:3001/internal/ops/raid-progress" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"                        # season mais recente gravada

curl "http://localhost:3001/internal/ops/raid-progress?season=17" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"
```

Mesma chamada que `GET /internal/raid-progress` já faz (`RaidProgressService.getReport`)
— uma pessoa logada consegue o mesmo resultado abrindo a área interna, ou
via `curl` com cookie de sessão válido. Esta rota existe só pra não exigir
login num `curl`/CLI; read-only, sem risco extra de expor nada que a área
interna já não mostre.

## Catálogo — listar instâncias do journal

Era `pnpm --filter api catalog:generate --lista [filtro]`.

```bash
curl "http://localhost:3001/internal/ops/catalog-instances" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"                        # 25 mais recentes

curl "http://localhost:3001/internal/ops/catalog-instances?filtro=voidspire" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"
```

## Catálogo — gerar

Era `pnpm --filter api catalog:generate <id> --saida <arquivo.json> [--slug <slug>] [--journal <arquivo>]`.

**Não escreve arquivo** — o container é efêmero. Devolve o JSON gerado no
corpo da resposta; salva local e segue o mesmo fluxo de revisão + commit de
antes:

```bash
curl -X POST "http://localhost:3001/internal/ops/catalog-generate" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"journalInstanceId": 1307, "slug": "the-voidspire"}' \
  -o catalogo/the-voidspire.json
```

Com a colagem do `/tilc journal` do addon (substitui `--journal <arquivo>` —
cola o conteúdo direto no campo `journalDump`, em vez de apontar pra um
arquivo que não existe dentro do container). **Colar o dump cru direto no
corpo quebra o JSON** — quebra de linha/tab sem escape dentro de uma string
não é JSON válido — então primeiro escapa com `pnpm dump:escape`
(`scripts/escape-dump.js`):

```bash
pnpm dump:escape dump.txt          # grava dump.json ao lado

curl -X POST "http://localhost:3001/internal/ops/catalog-generate" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(node -e 'console.log(JSON.stringify({journalInstanceId: 1307, journalDump: require("fs").readFileSync("dump.txt", "utf8")}))')" \
  -o catalogo/the-voidspire.json
```

(o `curl` acima ainda escapa inline com `node -e` porque o body inteiro,
`journalInstanceId` incluso, é montado na hora; `pnpm dump:escape` é o mesmo
`JSON.stringify`, só que gravado em arquivo — útil sozinho pro Yaak, abaixo.)

Pelo Yaak: aponte a variável `catalog_dump_path` (environment `Local`) pro
`dump.json` gerado por `pnpm dump:escape`, e o request `internal/ops/Catalog
generate` lê com `${[ fs.readFile(path=catalog_dump_path) ]}` — ver
`yaak/README.md`. **Não dá pra apontar direto pro `.txt` cru**: o Yaak não
escapa o conteúdo sozinho nesse meio-tempo — `json.escape()` não funciona na
versão atual da CLI (testado em 15/08/2026, devolve o texto sem escapar, sem
erro nenhum) — daí o arquivo intermediário ser obrigatório, não estilo.

**Aqueça o cache do Journal antes de colar o `/tilc journal`.** O cliente só
devolve dado confiável de um item do Encounter Journal depois que ele já
passou pelo cache local — descoberto em 14/08/2026 (ver TIT-124), gerando
`filterType` como `?` ou com valores como `-1`/`-4` numa raid cujo Journal
não tinha sido aberto na sessão. Isso não quebra mais o parser (`filterType`
é lido e descartado de propósito, ver `packages/shared/src/journal-dump.ts`),
mas o mesmo cache frio pode devolver a lista de **specs** incompleta para um
item — e essa vai para o catálogo sem nenhuma validação de completude, em
silêncio.

Antes de rodar `/tilc journal`: abra o Encounter Journal do jogo naquela
raid (idealmente visite cada boss) para aquecer o cache, ou rode o comando
de exportação mais de uma vez e compare as colagens — as duas formas
resolveram o sintoma na prática.

## Catálogo — carregar no banco

Era `pnpm --filter api catalog:load <arquivo.json> [--sem-conferencia]`.

```bash
curl -X POST "http://localhost:3001/internal/ops/catalog-load" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(node -e 'console.log(JSON.stringify({catalog: require("./catalogo/the-voidspire.json")}))')"

# sem conferência contra o Warcraft Logs (só se ele estiver fora do ar):
curl -X POST "http://localhost:3001/internal/ops/catalog-load" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(node -e 'console.log(JSON.stringify({catalog: require("./catalogo/the-voidspire.json"), semConferencia: true}))')"
```

Pelo Yaak: aponte a variável `catalog_json_path` (environment `Local`) pro
`.json` do catálogo (já gerado, sem passo extra nenhum), e o request
`internal/ops/Catalog load` lê com
`${[ fs.readFile(path=catalog_json_path) ]}` — ver `yaak/README.md`. Mais
simples que o `Catalog generate`: `catalog` no corpo é um **valor JSON**, não
uma string, então `fs.readFile()` puro já produz JSON válido — sem precisar
de `pnpm dump:escape`.

## Histórico — importar o export do RCLootCouncil

Rota nova (TIT-53), sem script antigo equivalente. O arquivo vai no corpo, igual
ao `catalog-load`: o container não tem o arquivo e é efêmero.

**Idempotente** pelo campo `id` do RC (`servertime-índice`). Rodar de novo
atualiza as mesmas linhas e devolve os mesmos números.

```bash
curl -X POST "http://localhost:3001/internal/ops/loot-import-rc" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @rclootcouncil_export.json
```

Resposta do export real (445 registros, 17/03 a 25/06/2026):

```json
{
  "lidos": 445,
  "gravados": 294,
  "descartados": 151,
  "bossResolvido": 217,
  "bossNaoResolvido": 77,
  "semDificuldade": 0
}
```

- **`descartados`** são bonus roll e personal loot — foram direto para o jogador,
  sem decisão do conselho a registrar. Descarte é resultado esperado, não erro.
- **`bossNaoResolvido`** é o nome do boss que não casou com o catálogo, por vir
  traduzido ou como `Unknown`. A linha entra assim mesmo, com o nome cru; exigir
  o vínculo recusaria histórico legítimo.

**Rótulo de resposta desconhecido recusa o arquivo inteiro**, com `400` listando
todas as combinações novas de uma vez. É deliberado: rótulo não mapeado é lacuna,
e gravar o resto em silêncio esconderia que faltou histórico. Acrescentar o rótulo
é um PR de uma linha em `packages/shared/src/loot-response.ts`.

## Sonda de roster (Raider.IO)

Era `node scripts/roster-probe.js "<Guilda>" <realm> [personagem...]`.

```bash
curl "http://localhost:3001/internal/ops/roster-probe?guild=Titan%20Inc&realm=Azralon&characters=Zenithus" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"
```

## Checagem de credencial Blizzard

Era `pnpm --filter api probe:oauth [personagem...]`.

```bash
curl "http://localhost:3001/internal/ops/oauth-check?characters=Zenithus" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"
```

Reaproveita o mesmo caminho que a app usa em produção
(`BlizzardService.getGuildRosterSnapshot`), então nunca imprime
`client_id`/`client_secret`/token — só o resultado da chamada. Sempre busca
fresco (`force: true`), mas se já existir cache de uma chamada anterior
bem-sucedida, uma falha degrada pra ele em vez de estourar — por isso o
campo `stale` na resposta: `stale: true` significa que aquilo **não** é uma
validação fresca da credencial.

## Correção dos ids do backfill de identidade (TIT-132)

`Character.id` é `@default(cuid())`, mas isso é avaliado em JS pelo Prisma —
não existe em SQL puro. O backfill de 16/08/2026 criou as 69 identidades
daquela rodada com `gen_random_uuid()`, então elas saíram em uuid em vez do
cuid que a aplicação sempre gerou (e continua gerando, em todo `resolver()`/
`resolverVarios()`/`resolverDoRoster()` do `CharactersRepository`).

Sem corpo — a operação não recebe parâmetro.

```bash
curl -X POST "http://localhost:3001/internal/ops/fix-character-ids" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"
```

```json
{
  "corrigidos": 69,
  "trocas": [{ "de": "a1b2c3d4-e5f6-7890-abcd-ef1234567890", "para": "cmsv4ocyc00005opg4hxu00tl" }]
}
```

**Não derruba nenhuma constraint.** Os 11 FKs que apontam para `Character.id`
são `ON UPDATE CASCADE` (conferido no `pg_constraint`) — o `UPDATE` no id
propaga sozinho para as tabelas filhas, sem janela em que uma referência
fique órfã.

**Idempotente**: o teste é o hífen (cuid nunca tem, uuid sempre tem), então
rodar de novo depois de corrigido não acha mais nenhum id fora do padrão e
devolve `corrigidos: 0`.

## Regerar o histórico de uma sessão de loot council (TIT-69)

O encerramento de uma sessão (`POST /internal/loot-sessions/:id/status` com
`status: "encerrada"`) já grava as linhas de histórico (`LootLine`, com
`source: "live_session"`) na MESMA transação que muda o status — ver o
comentário de `LootSessionsRepository.encerrarComHistorico`. Esta rota é a
rede de segurança para quando isso não bastar: sessão que ficou encerrada sem
histórico (dado de antes desta atomicidade, ou intervenção manual no banco).

Sem corpo — o único parâmetro é o id da sessão, no caminho. Recusa (400)
sessão que ainda não encerrou: regerar histórico de decisão em andamento não
faz sentido, porque os awards ainda podem mudar.

```bash
curl -X POST "http://localhost:3001/internal/ops/loot-sessions/<id>/regerar-historico" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"
```

```json
{ "linhas": 3 }
```

**Idempotente**: a chave é `LootSessionItem.id` (`LootLine.externalId`), única
por peça — rodar de novo atualiza as mesmas linhas em vez de duplicar.
Segura por construção, roda quantas vezes quiser.

## Gerar uma colagem de teste (TIT-68)

Ferramenta de teste do realtime da sessão ao vivo — não é fluxo de produção.
Sorteia um boss REAL do catálogo (com ao menos 3 drops cadastrados numa
dificuldade) e devolve o texto pronto para colar em "Iniciar sessão" na
área interna. Não cria a sessão sozinha, só poupa montar uma colagem válida
à mão.

```bash
curl "http://localhost:3001/internal/ops/loot-sessions/gerar-colagem" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"
```

```json
{ "paste": "TILC/1\tencounter=3176\tencounterName=...\n..." }
```

400 se o catálogo não tiver nenhum boss com pelo menos 3 itens cadastrados
numa dificuldade — gere/carregue o catálogo antes (`catalog-generate` /
`catalog-load`, acima).

## Simular jogadores numa sessão de loot (TIT-68)

Ferramenta de teste do realtime — não é fluxo de produção. Sobe N
personagens 100% sintéticos (`Dummy1..DummyN`, nunca um personagem real —
ver o comentário de `LootSessionDummiesService`), entra com eles na sessão
e, a cada ~2s, faz 1–2 ações dependendo da fase atual:

- **`aberta`**: um dummy responde a uma peça (escolhe opção, às vezes com
  nota). Responder de novo na mesma peça É a edição — não é caminho à parte.
- **`deliberando`**: só reage se o loot master reabriu a resposta de um
  dummy (`resposta-do-conselho`/reabrir); sem isso, fica ocioso no ciclo.
- **`encerrada`**: para sozinha.

Kill switch de 10 minutos a partir do INÍCIO da simulação (não da criação
da sessão) — o que vier primeiro entre isso e a sessão encerrar.

Fire-and-forget: a rota devolve na hora, o loop roda em segundo plano
dentro do próprio processo da api (Regra 8 — nada de `NestFactory`).

```bash
curl -X POST "http://localhost:3001/internal/ops/loot-sessions/<id>/rodar-dummies?quantidade=6" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN"
```

```json
{
  "dummies": [{ "name": "Dummy1", "realm": "TestDummy" }, ...],
  "killSwitchAt": "2026-08-16T19:11:01.158Z"
}
```

`?quantidade=` é opcional (padrão 6, clamp 2–10). 400 se a sessão já
encerrou; 409 se já existe uma simulação rodando para aquela sessão — uma
por vez, chame de novo depois que a anterior parar (kill switch, sessão
encerrada, ou a api reiniciar — o estado é em memória).
