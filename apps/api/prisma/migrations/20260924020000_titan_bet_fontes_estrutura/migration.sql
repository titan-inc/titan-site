-- Titan Bet — fontes da auditoria (D-60, D-63). Estrutura: a sessão usa todos os
-- titanbet* achados, cada um numa linha própria com a referência congelada; a
-- escolha do officer e a ambiguidade saem; entra a declaração "sem raid".

-- Os CHECKs da fonte citam os valores e as colunas que saem; caem antes.
ALTER TABLE "BetAuditSource" DROP CONSTRAINT "BetAuditSource_fonte_usada_tem_report";
ALTER TABLE "BetAuditSource" DROP CONSTRAINT "BetAuditSource_referencia_inteira";
ALTER TABLE "BetAuditSource" DROP CONSTRAINT "BetAuditSource_escolha_tem_officer";

-- AlterEnum
BEGIN;
CREATE TYPE "BetSourceResolution_new" AS ENUM ('automatica', 'ausente', 'sem_raid');
ALTER TABLE "BetAuditSource" ALTER COLUMN "resolution" TYPE "BetSourceResolution_new" USING ("resolution"::text::"BetSourceResolution_new");
ALTER TYPE "BetSourceResolution" RENAME TO "BetSourceResolution_old";
ALTER TYPE "BetSourceResolution_new" RENAME TO "BetSourceResolution";
DROP TYPE "BetSourceResolution_old";
COMMIT;

-- AlterTable
ALTER TABLE "BetAuditSource" DROP COLUMN "candidates",
DROP COLUMN "reportCode",
DROP COLUMN "reportRevision",
DROP COLUMN "reportStartTime",
DROP COLUMN "reportTitle",
ADD COLUMN     "noRaidReason" TEXT;

-- CreateTable
CREATE TABLE "BetAuditSourceReport" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reportCode" TEXT NOT NULL,
    "reportTitle" TEXT NOT NULL,
    "reportRevision" INTEGER NOT NULL,
    "reportStartTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BetAuditSourceReport_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BetAuditSourceReport" ADD CONSTRAINT "BetAuditSourceReport_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "BetAuditSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

