-- CreateTable
CREATE TABLE "RaidNight" (
    "id" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instance" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "seasonId" INTEGER,
    "reportCodes" TEXT[],
    "bossPulls" INTEGER,
    "hasSignups" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RaidNight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaidAttendance" (
    "id" TEXT NOT NULL,
    "raidNightId" INTEGER NOT NULL,
    "nameKey" TEXT NOT NULL,
    "realmKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "signup" TEXT,
    "raided" BOOLEAN,
    "firstPull" INTEGER,
    "pulls" INTEGER,
    "note" TEXT,
    "noteBy" TEXT,
    "noteAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RaidAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RaidNight_date_idx" ON "RaidNight"("date");

-- CreateIndex
CREATE INDEX "RaidNight_seasonId_idx" ON "RaidNight"("seasonId");

-- CreateIndex
CREATE INDEX "RaidAttendance_realmKey_nameKey_idx" ON "RaidAttendance"("realmKey", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "RaidAttendance_raidNightId_realmKey_nameKey_key" ON "RaidAttendance"("raidNightId", "realmKey", "nameKey");

-- AddForeignKey
ALTER TABLE "RaidAttendance" ADD CONSTRAINT "RaidAttendance_raidNightId_fkey" FOREIGN KEY ("raidNightId") REFERENCES "RaidNight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
