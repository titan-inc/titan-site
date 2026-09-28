-- CreateEnum
CREATE TYPE "BetEventType" AS ENUM ('ready_falhou');

-- CreateTable
CREATE TABLE "BetEvent" (
    "id" BIGSERIAL NOT NULL,
    "roundId" TEXT,
    "type" "BetEventType" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorBattletag" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "clientEventId" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BetEvent_roundId_id_idx" ON "BetEvent"("roundId", "id");

-- AddForeignKey
ALTER TABLE "BetEvent" ADD CONSTRAINT "BetEvent_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BetRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

