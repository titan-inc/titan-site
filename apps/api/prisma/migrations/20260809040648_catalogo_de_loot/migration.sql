-- CreateEnum
CREATE TYPE "RaidDifficulty" AS ENUM ('normal', 'heroic', 'mythic');

-- CreateTable
CREATE TABLE "CatalogItem" (
    "itemId" INTEGER NOT NULL,
    "name" TEXT,
    "icon" TEXT,
    "equipLoc" TEXT,
    "itemSubclass" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("itemId")
);

-- CreateTable
CREATE TABLE "CatalogRaid" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seasonId" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogRaid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogEncounter" (
    "id" TEXT NOT NULL,
    "raidId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogEncounter_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "CatalogItem_enrichedAt_idx" ON "CatalogItem"("enrichedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogRaid_slug_key" ON "CatalogRaid"("slug");

-- CreateIndex
CREATE INDEX "CatalogRaid_seasonId_idx" ON "CatalogRaid"("seasonId");

-- CreateIndex
CREATE INDEX "CatalogEncounter_raidId_idx" ON "CatalogEncounter"("raidId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogEncounter_raidId_position_key" ON "CatalogEncounter"("raidId", "position");

-- CreateIndex
CREATE INDEX "EncounterDrop_itemId_idx" ON "EncounterDrop"("itemId");

-- AddForeignKey
ALTER TABLE "CatalogRaid" ADD CONSTRAINT "CatalogRaid_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "GameSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogEncounter" ADD CONSTRAINT "CatalogEncounter_raidId_fkey" FOREIGN KEY ("raidId") REFERENCES "CatalogRaid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterDrop" ADD CONSTRAINT "EncounterDrop_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "CatalogEncounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterDrop" ADD CONSTRAINT "EncounterDrop_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("itemId") ON DELETE RESTRICT ON UPDATE CASCADE;
