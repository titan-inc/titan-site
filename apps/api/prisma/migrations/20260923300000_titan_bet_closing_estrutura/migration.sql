-- CreateTable
CREATE TABLE "RoundClosingReport" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "auditId" TEXT NOT NULL,
    "ledgerThroughEntryId" BIGINT NOT NULL,
    "content" JSONB NOT NULL,
    "publishedByUserId" TEXT NOT NULL,
    "publishedByBattletag" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoundClosingReport_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RoundClosingReport" ADD CONSTRAINT "RoundClosingReport_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BetRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundClosingReport" ADD CONSTRAINT "RoundClosingReport_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "BetAudit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

