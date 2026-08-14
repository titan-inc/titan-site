-- Sessão de loot council: um boss, os itens que caíram, e a decisão. TIT-62.
--
-- O `LootSessionEvent` é a FONTE DA VERDADE; as outras tabelas são projeção
-- escrita na mesma transação e reconstruível a partir do log. As projeções
-- existem para o `UNIQUE` impedir o impossível e para a tela ler sem dobrar o
-- log:
--
--   LootSessionAward.itemId UNIQUE       um item tem UM vencedor. É o que
--                                        resolve dois conselheiros awardando ao
--                                        mesmo tempo, sem lock nenhum
--   LootSessionResponse (item, personagem) UNIQUE   uma resposta por pessoa
--   LootSessionVote (item, votante) UNIQUE          um voto por conselheiro
--
-- Nenhuma FK para `User` nos atores, de propósito: `userId` + `battletag`, mesmo
-- precedente do `OfficerGrant.grantedBy`. Isto é registro, e registro não pode
-- ser apagado por exclusão de conta.

-- CreateEnum
CREATE TYPE "LootSessionStatus" AS ENUM ('rascunho', 'aberta', 'deliberando', 'encerrada');

-- CreateEnum
CREATE TYPE "LootSessionEventType" AS ENUM ('sessao_criada', 'item_adicionado', 'item_removido', 'status_alterado', 'resposta_dada', 'resposta_alterada', 'resposta_reaberta', 'voto_dado', 'item_awardado');

-- CreateTable
CREATE TABLE "LootSession" (
    "id" TEXT NOT NULL,
    "status" "LootSessionStatus" NOT NULL DEFAULT 'rascunho',
    "encounterId" TEXT,
    "rawEncounterId" INTEGER,
    "rawEncounterName" TEXT NOT NULL,
    "rawInstanceName" TEXT NOT NULL,
    "difficulty" "RaidDifficulty",
    "createdByUserId" TEXT NOT NULL,
    "createdByBattletag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "LootSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LootSessionItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "itemString" TEXT NOT NULL,
    "looterName" TEXT NOT NULL,
    "looterRealm" TEXT NOT NULL,

    CONSTRAINT "LootSessionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LootSessionResponse" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "realmKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "responseOptionSlug" TEXT NOT NULL,
    "roll" INTEGER NOT NULL,
    "aguardandoNovaResposta" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LootSessionResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LootSessionVote" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "candidateNameKey" TEXT NOT NULL,
    "candidateRealmKey" TEXT NOT NULL,
    "voterUserId" TEXT NOT NULL,
    "voterBattletag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LootSessionVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LootSessionAward" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "winnerNameKey" TEXT NOT NULL,
    "winnerRealmKey" TEXT NOT NULL,
    "winnerName" TEXT NOT NULL,
    "winnerRealm" TEXT NOT NULL,
    "responseOptionSlug" TEXT NOT NULL,
    "votes" INTEGER NOT NULL,
    "awardedByUserId" TEXT NOT NULL,
    "awardedByBattletag" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LootSessionAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LootSessionEvent" (
    "id" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "LootSessionEventType" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorBattletag" TEXT NOT NULL,
    "clientEventId" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LootSessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LootSession_status_created_at_idx" ON "LootSession"("status", "created_at");

-- CreateIndex
CREATE INDEX "LootSession_encounterId_idx" ON "LootSession"("encounterId");

-- CreateIndex
CREATE INDEX "LootSessionItem_sessionId_idx" ON "LootSessionItem"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "LootSessionItem_sessionId_position_key" ON "LootSessionItem"("sessionId", "position");

-- CreateIndex
CREATE INDEX "LootSessionResponse_itemId_idx" ON "LootSessionResponse"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "LootSessionResponse_itemId_nameKey_realmKey_key" ON "LootSessionResponse"("itemId", "nameKey", "realmKey");

-- CreateIndex
CREATE INDEX "LootSessionVote_itemId_idx" ON "LootSessionVote"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "LootSessionVote_itemId_voterUserId_key" ON "LootSessionVote"("itemId", "voterUserId");

-- CreateIndex
CREATE UNIQUE INDEX "LootSessionAward_itemId_key" ON "LootSessionAward"("itemId");

-- CreateIndex
CREATE INDEX "LootSessionEvent_sessionId_id_idx" ON "LootSessionEvent"("sessionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LootSessionEvent_sessionId_clientEventId_key" ON "LootSessionEvent"("sessionId", "clientEventId");

-- AddForeignKey
ALTER TABLE "LootSession" ADD CONSTRAINT "LootSession_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "LootCatalogEncounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LootSessionItem" ADD CONSTRAINT "LootSessionItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LootSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LootSessionResponse" ADD CONSTRAINT "LootSessionResponse_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LootSessionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LootSessionResponse" ADD CONSTRAINT "LootSessionResponse_responseOptionSlug_fkey" FOREIGN KEY ("responseOptionSlug") REFERENCES "LootResponseOption"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LootSessionVote" ADD CONSTRAINT "LootSessionVote_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LootSessionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LootSessionAward" ADD CONSTRAINT "LootSessionAward_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LootSessionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LootSessionAward" ADD CONSTRAINT "LootSessionAward_responseOptionSlug_fkey" FOREIGN KEY ("responseOptionSlug") REFERENCES "LootResponseOption"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LootSessionEvent" ADD CONSTRAINT "LootSessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LootSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

