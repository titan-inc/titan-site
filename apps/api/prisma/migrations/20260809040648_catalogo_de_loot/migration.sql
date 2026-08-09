-- CreateEnum
CREATE TYPE "RaidDifficulty" AS ENUM ('normal', 'heroic', 'mythic');

-- CreateTable
CREATE TABLE "WowItem" (
    "itemId" INTEGER NOT NULL,
    "name" TEXT,
    "icon" TEXT,
    "equipLoc" TEXT,
    "itemSubclass" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WowItem_pkey" PRIMARY KEY ("itemId")
);

-- CreateTable
CREATE TABLE "LootCatalogRaid" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seasonId" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LootCatalogRaid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LootCatalogEncounter" (
    "id" TEXT NOT NULL,
    "raidId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LootCatalogEncounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncounterDrop" (
    "encounterId" TEXT NOT NULL,
    "difficulty" "RaidDifficulty" NOT NULL,
    "itemId" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncounterDrop_pkey" PRIMARY KEY ("encounterId","difficulty","itemId")
);

-- CreateIndex
CREATE INDEX "WowItem_enrichedAt_idx" ON "WowItem"("enrichedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LootCatalogRaid_slug_key" ON "LootCatalogRaid"("slug");

-- CreateIndex
CREATE INDEX "LootCatalogRaid_seasonId_idx" ON "LootCatalogRaid"("seasonId");

-- CreateIndex
CREATE INDEX "LootCatalogEncounter_raidId_idx" ON "LootCatalogEncounter"("raidId");

-- CreateIndex
CREATE UNIQUE INDEX "LootCatalogEncounter_raidId_position_key" ON "LootCatalogEncounter"("raidId", "position");

-- CreateIndex
CREATE INDEX "EncounterDrop_itemId_idx" ON "EncounterDrop"("itemId");

-- AddForeignKey
ALTER TABLE "LootCatalogRaid" ADD CONSTRAINT "LootCatalogRaid_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "GameSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LootCatalogEncounter" ADD CONSTRAINT "LootCatalogEncounter_raidId_fkey" FOREIGN KEY ("raidId") REFERENCES "LootCatalogRaid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterDrop" ADD CONSTRAINT "EncounterDrop_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "LootCatalogEncounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterDrop" ADD CONSTRAINT "EncounterDrop_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WowItem"("itemId") ON DELETE RESTRICT ON UPDATE CASCADE;
