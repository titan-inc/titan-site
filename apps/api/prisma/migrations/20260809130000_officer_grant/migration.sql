-- Ser oficial deixa de ser coluna no User e passa a ser derivado de OfficerGrant.
--
-- A permissão precisa poder ser concedida ANTES do primeiro login, e conta só
-- existe depois do OAuth. Guardar uma cópia no User criaria duas verdades e um
-- jeito silencioso de revogar sem o acesso cair.
--
-- Nada de dado real se perde aqui: a coluna estava em `false` para todo mundo,
-- porque nunca houve caminho no código que a escrevesse.

-- AlterTable
ALTER TABLE "User" DROP COLUMN "isOfficer";

-- CreateTable
CREATE TABLE "OfficerGrant" (
    "id" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "realmSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficerGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfficerGrant_realmSlug_nameKey_idx" ON "OfficerGrant"("realmSlug", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "OfficerGrant_realmSlug_nameKey_key" ON "OfficerGrant"("realmSlug", "nameKey");
