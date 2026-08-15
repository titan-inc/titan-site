-- Identidade de personagem, passo 3 de 3: CONTRACT.
--
-- Aperta as constraints e apaga as colunas antigas. Este passo **falha alto** se
-- o backfill deixou buraco: `SET NOT NULL` numa coluna com nulo aborta, e é
-- exatamente o que se quer — melhor a migration parar do que a aplicação subir
-- com linha de histórico sem dono.
--
-- O `UNIQUE` do `GuildCharacter.characterId` também é uma verificação: ele
-- aborta se o mesmo personagem estiver em duas contas, que é estado que não
-- deveria existir (WoW não permite) e que ninguém teria notado até aqui.

ALTER TABLE "GuildCharacter" ALTER COLUMN "characterId" SET NOT NULL;
ALTER TABLE "OfficerGrant" ALTER COLUMN "characterId" SET NOT NULL;
ALTER TABLE "CharacterSnapshot" ALTER COLUMN "characterId" SET NOT NULL;
ALTER TABLE "RaidAttendance" ALTER COLUMN "characterId" SET NOT NULL;
ALTER TABLE "LootSessionParticipant" ALTER COLUMN "characterId" SET NOT NULL;
ALTER TABLE "LootSessionResponse" ALTER COLUMN "characterId" SET NOT NULL;
ALTER TABLE "LootSessionVote" ALTER COLUMN "candidateCharacterId" SET NOT NULL;
ALTER TABLE "LootSessionAward" ALTER COLUMN "winnerCharacterId" SET NOT NULL;
ALTER TABLE "LootLine" ALTER COLUMN "winnerCharacterId" SET NOT NULL;
-- `looterCharacterId` continua nulável: nem toda fonte diz quem lootou.

-- Índices e uniques antigos, que descreviam a identidade em cada tabela.
DROP INDEX "GuildCharacter_userId_realmSlug_nameKey_key";
DROP INDEX "GuildCharacter_realmSlug_nameKey_idx";
DROP INDEX "OfficerGrant_realmSlug_nameKey_key";
DROP INDEX "OfficerGrant_realmSlug_nameKey_idx";
DROP INDEX "CharacterSnapshot_period_realmSlug_nameKey_key";
DROP INDEX "CharacterSnapshot_realmSlug_nameKey_idx";
DROP INDEX "RaidAttendance_raidNightId_realmKey_nameKey_key";
DROP INDEX "RaidAttendance_realmKey_nameKey_idx";
DROP INDEX "LootSessionResponse_itemId_nameKey_realmKey_key";
DROP INDEX "LootLine_winnerNameKey_winnerRealmKey_awardedAt_idx";

ALTER TABLE "GuildCharacter" DROP COLUMN "nameKey", DROP COLUMN "realmSlug", DROP COLUMN "name";
ALTER TABLE "OfficerGrant"
  DROP COLUMN "nameKey", DROP COLUMN "realmSlug", DROP COLUMN "name", DROP COLUMN "realm";
ALTER TABLE "CharacterSnapshot" DROP COLUMN "nameKey", DROP COLUMN "realmSlug", DROP COLUMN "name";
ALTER TABLE "RaidAttendance"
  DROP COLUMN "nameKey", DROP COLUMN "realmKey", DROP COLUMN "name", DROP COLUMN "realm";
ALTER TABLE "LootSessionParticipant"
  DROP COLUMN "nameKey", DROP COLUMN "realmKey", DROP COLUMN "name", DROP COLUMN "realm";
ALTER TABLE "LootSessionResponse"
  DROP COLUMN "nameKey", DROP COLUMN "realmKey", DROP COLUMN "name", DROP COLUMN "realm";
ALTER TABLE "LootSessionVote"
  DROP COLUMN "candidateNameKey", DROP COLUMN "candidateRealmKey";
ALTER TABLE "LootSessionAward"
  DROP COLUMN "winnerNameKey", DROP COLUMN "winnerRealmKey",
  DROP COLUMN "winnerName", DROP COLUMN "winnerRealm";
ALTER TABLE "LootLine"
  DROP COLUMN "winnerNameKey", DROP COLUMN "winnerRealmKey",
  DROP COLUMN "winnerName", DROP COLUMN "winnerRealm", DROP COLUMN "winnerClass",
  DROP COLUMN "looterNameKey", DROP COLUMN "looterRealmKey",
  DROP COLUMN "looterName", DROP COLUMN "looterRealm";

CREATE UNIQUE INDEX "GuildCharacter_characterId_key" ON "GuildCharacter"("characterId");
CREATE UNIQUE INDEX "OfficerGrant_characterId_key" ON "OfficerGrant"("characterId");
CREATE UNIQUE INDEX "CharacterSnapshot_period_characterId_key" ON "CharacterSnapshot"("period", "characterId");
CREATE INDEX "CharacterSnapshot_characterId_idx" ON "CharacterSnapshot"("characterId");
CREATE UNIQUE INDEX "RaidAttendance_raidNightId_characterId_key" ON "RaidAttendance"("raidNightId", "characterId");
CREATE INDEX "RaidAttendance_characterId_idx" ON "RaidAttendance"("characterId");
CREATE UNIQUE INDEX "LootSessionResponse_itemId_characterId_key" ON "LootSessionResponse"("itemId", "characterId");
-- "O histórico desta pessoa", que é a consulta central da Regra 7.
CREATE INDEX "LootLine_winnerCharacterId_awardedAt_idx" ON "LootLine"("winnerCharacterId", "awardedAt");

ALTER TABLE "GuildCharacter" ADD CONSTRAINT "GuildCharacter_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfficerGrant" ADD CONSTRAINT "OfficerGrant_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharacterSnapshot" ADD CONSTRAINT "CharacterSnapshot_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RaidAttendance" ADD CONSTRAINT "RaidAttendance_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LootSessionParticipant" ADD CONSTRAINT "LootSessionParticipant_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LootSessionResponse" ADD CONSTRAINT "LootSessionResponse_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LootSessionVote" ADD CONSTRAINT "LootSessionVote_candidateCharacterId_fkey"
  FOREIGN KEY ("candidateCharacterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LootSessionAward" ADD CONSTRAINT "LootSessionAward_winnerCharacterId_fkey"
  FOREIGN KEY ("winnerCharacterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LootLine" ADD CONSTRAINT "LootLine_winnerCharacterId_fkey"
  FOREIGN KEY ("winnerCharacterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LootLine" ADD CONSTRAINT "LootLine_looterCharacterId_fkey"
  FOREIGN KEY ("looterCharacterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
