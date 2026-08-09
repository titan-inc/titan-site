-- AlterTable
ALTER TABLE "LootCatalogRaid" ADD COLUMN     "instanceMapId" INTEGER;

-- AlterTable
ALTER TABLE "LootCatalogEncounter" ADD COLUMN     "dungeonEncounterId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "LootCatalogEncounter_dungeonEncounterId_key" ON "LootCatalogEncounter"("dungeonEncounterId");
