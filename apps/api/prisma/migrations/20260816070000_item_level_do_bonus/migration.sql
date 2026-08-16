-- WowBonus.itemLevel: o ilvl que um bonus de track determina, quando curado
-- — TIT-82/TIT-136. Nulo é "não curado ainda", não "sem ilvl".

-- AlterTable
ALTER TABLE "WowBonus" ADD COLUMN "itemLevel" INTEGER;
