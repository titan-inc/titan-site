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
arquivo que não existe dentro do container):

```bash
curl -X POST "http://localhost:3001/internal/ops/catalog-generate" \
  -H "X-Ops-Token: $OPS_TRIGGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(node -e 'console.log(JSON.stringify({journalInstanceId: 1307, journalDump: require("fs").readFileSync("dump.txt", "utf8")}))')" \
  -o catalogo/the-voidspire.json
```

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
