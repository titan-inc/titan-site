-- CreateTable
CREATE TABLE "RotationRoleLock" (
    "role" TEXT NOT NULL,
    "lockedBy" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RotationRoleLock_pkey" PRIMARY KEY ("role")
);

-- CreateTable
CREATE TABLE "RotationPlayerLock" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "lockedBy" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RotationPlayerLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationPlan" (
    "id" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "savedBy" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RotationPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationPlanEntry" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,

    CONSTRAINT "RotationPlanEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RotationPlayerLock_characterId_key" ON "RotationPlayerLock"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "RotationPlan_weekStart_key" ON "RotationPlan"("weekStart");

-- CreateIndex
CREATE INDEX "RotationPlanEntry_characterId_idx" ON "RotationPlanEntry"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "RotationPlanEntry_planId_characterId_key" ON "RotationPlanEntry"("planId", "characterId");

-- AddForeignKey
ALTER TABLE "RotationPlayerLock" ADD CONSTRAINT "RotationPlayerLock_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationPlanEntry" ADD CONSTRAINT "RotationPlanEntry_planId_fkey" FOREIGN KEY ("planId") REFERENCES "RotationPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationPlanEntry" ADD CONSTRAINT "RotationPlanEntry_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
