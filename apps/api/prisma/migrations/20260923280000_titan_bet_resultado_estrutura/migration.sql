-- CreateEnum
CREATE TYPE "BetResultOutcome" AS ENUM ('vencedores', 'anulado');

-- CreateTable
CREATE TABLE "BetMarketResult" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "outcome" "BetResultOutcome" NOT NULL,
    "voidReason" TEXT,
    "validPool" INTEGER NOT NULL,
    "prizePool" INTEGER,
    "winningStake" INTEGER,
    "evidence" JSONB NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetMarketResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetMarketResultWinner" (
    "resultId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,

    CONSTRAINT "BetMarketResultWinner_pkey" PRIMARY KEY ("resultId","characterId")
);

-- CreateTable
CREATE TABLE "BetMarketResultKill" (
    "resultId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "roundEncounterId" TEXT NOT NULL,

    CONSTRAINT "BetMarketResultKill_pkey" PRIMARY KEY ("resultId","roundEncounterId")
);

-- AddForeignKey
ALTER TABLE "BetMarketResult" ADD CONSTRAINT "BetMarketResult_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "BetAudit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetMarketResult" ADD CONSTRAINT "BetMarketResult_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "BetMarket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetMarketResult" ADD CONSTRAINT "BetMarketResult_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BetRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetMarketResultWinner" ADD CONSTRAINT "BetMarketResultWinner_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "BetMarketResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetMarketResultWinner" ADD CONSTRAINT "BetMarketResultWinner_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetMarketResultKill" ADD CONSTRAINT "BetMarketResultKill_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "BetMarketResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetMarketResultKill" ADD CONSTRAINT "BetMarketResultKill_roundEncounterId_fkey" FOREIGN KEY ("roundEncounterId") REFERENCES "BetRoundEncounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

