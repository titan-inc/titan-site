-- A LootLine vira o registro da decisão do NOSSO conselho — o import se adapta
-- a ela, e não o contrário (TIT-130).
--
-- A tabela é TRUNCADA e reimportada, em vez de receber backfill: o app ainda
-- está em desenvolvimento, hoje existem zero linhas produzidas por sessão (só
-- import), e montar o `rawImportedLine` novo a partir das colunas antigas
-- produziria um registro de origem FALSO — cinco campos com cara de fonte
-- completa, que é o pior tipo de dado. O arquivo do export continua conosco;
-- reimportar é a rota de ops `internal/ops/loot-import-rc` (ver docs/ops.md).
TRUNCATE "LootLine";

-- Sai o bruto picado do RCLootCouncil. Vira uma coluna só, `rawImportedLine`,
-- mais abaixo — e nenhuma leitura da aplicação passa por ela.
--
-- `rawBoss`/`rawInstance` em especial: 56 dos 77 registros sem boss resolvido
-- tinham `rawBoss` igual a `Unknown`/`Desconhecido` — não era informação
-- preservada, era o texto interno de outra ferramenta com cara de dado nosso.
ALTER TABLE "LootLine"
  DROP COLUMN "rawInstance",
  DROP COLUMN "rawBoss",
  DROP COLUMN "rawResponse",
  DROP COLUMN "rawResponseId",
  DROP COLUMN "rawReplacedGear";

-- `note` ficou ambíguo assim que ganhou uma nota do CONSELHO ao lado
-- (`councilNote`, mais abaixo). O conteúdo do import é sempre do jogador — o
-- addon do RCLootCouncil não oferece campo de nota ao loot master — então o
-- rename é dizer o que a coluna sempre foi.
ALTER TABLE "LootLine" RENAME COLUMN "note" TO "playerNote";

-- A tabela está vazia (truncada acima), então `SET NOT NULL` não pode falhar
-- por linha órfã. É o que dá trava de duplicata à linha vinda de sessão
-- (TIT-69): no Postgres, NULL não é barrado por UNIQUE.
ALTER TABLE "LootLine" ALTER COLUMN "externalId" SET NOT NULL;

-- sessionId: o caminho de volta para quem pediu, quem votou e quem decidiu —
-- nulo é import. awardedByUserId/awardedByBattletag: quem entregou, sem FK
-- para User, mesmo precedente de LootSession.createdBy e OfficerGrant.grantedBy
-- — nulos só no import. councilNote: a justificativa do conselho, que não
-- existia no import. responseKind: o kind da resposta CONGELADO no momento da
-- entrega — nunca nulo, é o que distingue peça entregue ao jogador de peça que
-- foi para o banco. rawImportedLine: o registro de origem inteiro, como veio;
-- nulo na sessão ao vivo, que nasce no nosso formato.
ALTER TABLE "LootLine"
  ADD COLUMN "sessionId" TEXT,
  ADD COLUMN "awardedByUserId" TEXT,
  ADD COLUMN "awardedByBattletag" TEXT,
  ADD COLUMN "councilNote" TEXT,
  ADD COLUMN "responseKind" "LootResponseKind" NOT NULL,
  ADD COLUMN "rawImportedLine" JSONB;

CREATE INDEX "LootLine_sessionId_idx" ON "LootLine"("sessionId");

ALTER TABLE "LootLine" ADD CONSTRAINT "LootLine_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "LootSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
