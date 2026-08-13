-- Linha de loot: uma peça entregue a alguém por decisão do conselho.
--
-- Uma tabela só para o histórico importado e para as sessões ao vivo, separados
-- por `source`.
--
-- Sobre o `UNIQUE (source, externalId)`: no Postgres NULL é distinto de NULL num
-- índice único, então várias linhas de `live_session` com `externalId` nulo
-- convivem sem conflito. É o comportamento desejado — sessão ao vivo nasce aqui e
-- não tem id de fora. A restrição existe para o import: reimportar o mesmo
-- arquivo não duplica.

-- CreateEnum
CREATE TYPE "LootLineSource" AS ENUM ('import_rc', 'import_wowaudit', 'live_session');

-- CreateTable
CREATE TABLE "LootLine" (
    "id" TEXT NOT NULL,
    "source" "LootLineSource" NOT NULL,
    "externalId" TEXT,
    "awardedAt" TIMESTAMP(3) NOT NULL,
    "winnerNameKey" TEXT NOT NULL,
    "winnerRealmSlug" TEXT NOT NULL,
    "winnerName" TEXT NOT NULL,
    "winnerRealm" TEXT NOT NULL,
    "winnerClass" TEXT,
    "looterNameKey" TEXT,
    "looterRealmSlug" TEXT,
    "looterName" TEXT,
    "looterRealm" TEXT,
    "itemId" INTEGER NOT NULL,
    "itemString" TEXT NOT NULL,
    "rawInstance" TEXT NOT NULL,
    "rawBoss" TEXT NOT NULL,
    "encounterId" TEXT,
    "difficulty" "RaidDifficulty",
    "responseOptionSlug" TEXT NOT NULL,
    "rawResponse" TEXT,
    "rawResponseId" TEXT,
    "votes" INTEGER,
    "note" TEXT,
    "rawReplacedGear" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LootLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LootLine_winnerNameKey_winnerRealmSlug_awardedAt_idx" ON "LootLine"("winnerNameKey", "winnerRealmSlug", "awardedAt");

-- CreateIndex
CREATE INDEX "LootLine_itemId_idx" ON "LootLine"("itemId");

-- CreateIndex
CREATE INDEX "LootLine_encounterId_idx" ON "LootLine"("encounterId");

-- CreateIndex
CREATE INDEX "LootLine_awardedAt_idx" ON "LootLine"("awardedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LootLine_source_externalId_key" ON "LootLine"("source", "externalId");

-- AddForeignKey
ALTER TABLE "LootLine" ADD CONSTRAINT "LootLine_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "LootCatalogEncounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LootLine" ADD CONSTRAINT "LootLine_responseOptionSlug_fkey" FOREIGN KEY ("responseOptionSlug") REFERENCES "LootResponseOption"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;
