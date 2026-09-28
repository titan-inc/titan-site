-- CreateEnum
CREATE TYPE "BetMarketKind" AS ENUM ('top_dps', 'top_dps_parse', 'top_hps', 'top_hps_parse', 'top_dispels', 'first_death', 'weekly_progression');

-- CreateEnum
CREATE TYPE "BetEncounterTrack" AS ENUM ('farm', 'progressao');

-- CreateEnum
CREATE TYPE "BetCandidateRole" AS ENUM ('Tank', 'Melee', 'Heal', 'Ranged');

-- CreateEnum
CREATE TYPE "BetSlipStatus" AS ENUM ('rascunho', 'aguardando_deposito', 'valido', 'recusado', 'expirado');

-- CreateTable
CREATE TABLE "BetRound" (
    "id" TEXT NOT NULL,
    "period" INTEGER NOT NULL,
    "seasonId" INTEGER,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "cutoffAt" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3),
    "readyByUserId" TEXT,
    "readyByBattletag" TEXT,
    "bettorSourceFetchedAt" TIMESTAMP(3),
    "candidateSourceFetchedAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetRoundEncounter" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "encounterId" INTEGER NOT NULL,
    "encounterName" TEXT NOT NULL,
    "zoneName" TEXT NOT NULL,
    "track" "BetEncounterTrack" NOT NULL,
    "inWeeklyProgression" BOOLEAN NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdByBattletag" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "updatedByBattletag" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BetRoundEncounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetMarket" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "kind" "BetMarketKind" NOT NULL,
    "roundEncounterId" TEXT,
    "track" "BetEncounterTrack",
    "createdByUserId" TEXT NOT NULL,
    "createdByBattletag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetMarket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetRoundBettor" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "realm" TEXT NOT NULL,

    CONSTRAINT "BetRoundBettor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetRoundCandidate" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "role" "BetCandidateRole" NOT NULL,
    "name" TEXT NOT NULL,
    "realm" TEXT NOT NULL,

    CONSTRAINT "BetRoundCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetSlip" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "ownerBattletag" TEXT NOT NULL,
    "eligibilityCharacterId" TEXT NOT NULL,
    "status" "BetSlipStatus" NOT NULL DEFAULT 'rascunho',
    "depositCharacterId" TEXT,
    "expectedTotal" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "validatedByUserId" TEXT,
    "validatedByBattletag" TEXT,
    "validatedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedByBattletag" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "expiredAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BetSlip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bet" (
    "id" TEXT NOT NULL,
    "slipId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "marketKind" "BetMarketKind" NOT NULL,
    "stake" INTEGER NOT NULL,
    "targetCharacterId" TEXT,
    "targetRole" "BetCandidateRole",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetWeeklySelection" (
    "betId" TEXT NOT NULL,
    "roundEncounterId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "marketKind" "BetMarketKind" NOT NULL,
    "inWeeklyProgression" BOOLEAN NOT NULL,

    CONSTRAINT "BetWeeklySelection_pkey" PRIMARY KEY ("betId","roundEncounterId")
);

-- AddForeignKey
ALTER TABLE "BetRoundEncounter" ADD CONSTRAINT "BetRoundEncounter_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BetRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetMarket" ADD CONSTRAINT "BetMarket_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BetRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetMarket" ADD CONSTRAINT "BetMarket_roundEncounterId_fkey" FOREIGN KEY ("roundEncounterId") REFERENCES "BetRoundEncounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetRoundBettor" ADD CONSTRAINT "BetRoundBettor_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BetRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetRoundBettor" ADD CONSTRAINT "BetRoundBettor_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetRoundCandidate" ADD CONSTRAINT "BetRoundCandidate_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BetRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetRoundCandidate" ADD CONSTRAINT "BetRoundCandidate_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetSlip" ADD CONSTRAINT "BetSlip_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BetRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetSlip" ADD CONSTRAINT "BetSlip_eligibilityCharacterId_fkey" FOREIGN KEY ("eligibilityCharacterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetSlip" ADD CONSTRAINT "BetSlip_depositCharacterId_fkey" FOREIGN KEY ("depositCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "BetSlip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BetRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "BetMarket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_targetCharacterId_fkey" FOREIGN KEY ("targetCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetWeeklySelection" ADD CONSTRAINT "BetWeeklySelection_betId_fkey" FOREIGN KEY ("betId") REFERENCES "Bet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetWeeklySelection" ADD CONSTRAINT "BetWeeklySelection_roundEncounterId_fkey" FOREIGN KEY ("roundEncounterId") REFERENCES "BetRoundEncounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetWeeklySelection" ADD CONSTRAINT "BetWeeklySelection_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BetRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

