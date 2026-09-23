-- CreateEnum
CREATE TYPE "BetAuditStatus" AS ENUM ('aguardando_revisao', 'pronta', 'calculada', 'confirmada', 'substituida');

-- CreateEnum
CREATE TYPE "BetAuditSession" AS ENUM ('terca', 'quinta');

-- CreateEnum
CREATE TYPE "BetSourceResolution" AS ENUM ('automatica', 'escolha_officer', 'ausente', 'ambigua');

-- CreateTable
CREATE TABLE "BetAudit" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "BetAuditStatus" NOT NULL,
    "startedByUserId" TEXT NOT NULL,
    "startedByBattletag" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculatedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "confirmedByBattletag" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "supersededByAuditId" TEXT,

    CONSTRAINT "BetAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetAuditSource" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "session" "BetAuditSession" NOT NULL,
    "resolution" "BetSourceResolution" NOT NULL,
    "reportCode" TEXT,
    "reportTitle" TEXT,
    "reportRevision" INTEGER,
    "reportStartTime" TIMESTAMP(3),
    "candidates" JSONB NOT NULL,
    "resolvedByUserId" TEXT,
    "resolvedByBattletag" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "BetAuditSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BetAudit_roundId_attempt_key" ON "BetAudit"("roundId", "attempt");

-- AddForeignKey
ALTER TABLE "BetAudit" ADD CONSTRAINT "BetAudit_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BetRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetAuditSource" ADD CONSTRAINT "BetAuditSource_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "BetAudit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

