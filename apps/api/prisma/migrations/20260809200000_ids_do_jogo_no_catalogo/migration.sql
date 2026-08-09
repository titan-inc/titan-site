-- AlterTable
ALTER TABLE "CatalogRaid" ADD COLUMN     "instanceMapId" INTEGER;

-- AlterTable
ALTER TABLE "CatalogEncounter" ADD COLUMN     "dungeonEncounterId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "CatalogEncounter_dungeonEncounterId_key" ON "CatalogEncounter"("dungeonEncounterId");
