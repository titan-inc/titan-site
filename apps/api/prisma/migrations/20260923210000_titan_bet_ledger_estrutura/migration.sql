-- CreateEnum
CREATE TYPE "GoldLedgerAccount" AS ENUM ('membro', 'guild_bank');

-- CreateEnum
CREATE TYPE "GoldLedgerKind" AS ENUM ('deposito_validado', 'premio', 'restituicao_anulado', 'receita_guilda', 'residuo_guilda', 'restituicao_expirado', 'ajuste', 'pagamento');

-- CreateTable
CREATE TABLE "GoldLedgerEntry" (
    "id" BIGSERIAL NOT NULL,
    "roundId" TEXT NOT NULL,
    "account" "GoldLedgerAccount" NOT NULL,
    "slipId" TEXT,
    "kind" "GoldLedgerKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "marketId" TEXT,
    "betId" TEXT,
    "resultId" TEXT,
    "correctsEntryId" BIGINT,
    "reason" TEXT,
    "coversThroughEntryId" BIGINT,
    "actorUserId" TEXT,
    "actorBattletag" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoldLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "GoldLedgerEntry" ADD CONSTRAINT "GoldLedgerEntry_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BetRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldLedgerEntry" ADD CONSTRAINT "GoldLedgerEntry_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "BetSlip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldLedgerEntry" ADD CONSTRAINT "GoldLedgerEntry_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "BetMarket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldLedgerEntry" ADD CONSTRAINT "GoldLedgerEntry_betId_fkey" FOREIGN KEY ("betId") REFERENCES "Bet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldLedgerEntry" ADD CONSTRAINT "GoldLedgerEntry_correctsEntryId_fkey" FOREIGN KEY ("correctsEntryId") REFERENCES "GoldLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldLedgerEntry" ADD CONSTRAINT "GoldLedgerEntry_coversThroughEntryId_fkey" FOREIGN KEY ("coversThroughEntryId") REFERENCES "GoldLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

