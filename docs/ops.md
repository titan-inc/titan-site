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

**Não tem rota em `/internal/ops`** — já existe `GET /internal/raid-progress`
fazendo exatamente a mesma coisa (`RaidProgressService.getReport`), rodando,
protegida por sessão de membro. Era `pnpm --filter api probe:raid [season]`;
uma pessoa logada consegue o mesmo resultado abrindo a área interna, ou via
`curl` com cookie de sessão válido.

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
