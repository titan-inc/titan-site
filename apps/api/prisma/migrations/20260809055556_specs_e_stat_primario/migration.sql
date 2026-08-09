-- CreateEnum
CREATE TYPE "PrimaryStat" AS ENUM ('strength', 'agility', 'intellect');

-- CreateEnum
CREATE TYPE "WowSpec" AS ENUM ('death_knight_blood', 'death_knight_frost', 'death_knight_unholy', 'demon_hunter_havoc', 'demon_hunter_vengeance', 'druid_balance', 'druid_feral', 'druid_guardian', 'druid_restoration', 'evoker_augmentation', 'evoker_devastation', 'evoker_preservation', 'hunter_beast_mastery', 'hunter_marksmanship', 'hunter_survival', 'mage_arcane', 'mage_fire', 'mage_frost', 'monk_brewmaster', 'monk_mistweaver', 'monk_windwalker', 'paladin_holy', 'paladin_protection', 'paladin_retribution', 'priest_discipline', 'priest_holy', 'priest_shadow', 'rogue_assassination', 'rogue_outlaw', 'rogue_subtlety', 'shaman_elemental', 'shaman_enhancement', 'shaman_restoration', 'warlock_affliction', 'warlock_demonology', 'warlock_destruction', 'warrior_arms', 'warrior_fury', 'warrior_protection');

-- AlterTable
ALTER TABLE "WowItem" ADD COLUMN     "primaryStats" "PrimaryStat"[],
ADD COLUMN     "specsCuratedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WowItemSpec" (
    "itemId" INTEGER NOT NULL,
    "spec" "WowSpec" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WowItemSpec_pkey" PRIMARY KEY ("itemId","spec")
);

-- CreateIndex
CREATE INDEX "WowItemSpec_spec_idx" ON "WowItemSpec"("spec");

-- AddForeignKey
ALTER TABLE "WowItemSpec" ADD CONSTRAINT "WowItemSpec_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WowItem"("itemId") ON DELETE CASCADE ON UPDATE CASCADE;
