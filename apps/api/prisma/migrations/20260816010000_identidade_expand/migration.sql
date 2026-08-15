-- Identidade de personagem, passo 1 de 3: EXPAND.
--
-- Cria a tabela e acrescenta as colunas novas em todo mundo, TODAS NULÁVEIS —
-- mesmo as que vão terminar `NOT NULL`. Assim este passo não pode falhar por
-- causa de dado, e o backfill (passo 2) roda contra um schema que já tem para
-- onde escrever. O passo 3 é que aperta as constraints.
--
-- Três migrations em vez de uma porque uma só teria que criar, popular e
-- restringir na mesma transação: se o backfill errasse, o diagnóstico viria
-- junto com um rollback de tudo, e não dá para inspecionar o que aconteceu.

CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "realmKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "class" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- A identidade é o par nome + realm, nunca o nome sozinho: WoW garante nome
-- único por realm, e é por isso que quem acha o nome ocupado registra uma
-- variação acentuada dele. Ver Regra 6.
CREATE UNIQUE INDEX "Character_nameKey_realmKey_key" ON "Character"("nameKey", "realmKey");

ALTER TABLE "GuildCharacter" ADD COLUMN "characterId" TEXT;
ALTER TABLE "OfficerGrant" ADD COLUMN "characterId" TEXT;
ALTER TABLE "CharacterSnapshot" ADD COLUMN "characterId" TEXT;
ALTER TABLE "RaidAttendance" ADD COLUMN "characterId" TEXT;
ALTER TABLE "LootSessionParticipant" ADD COLUMN "characterId" TEXT;
ALTER TABLE "LootSessionResponse" ADD COLUMN "characterId" TEXT;
ALTER TABLE "LootSessionVote" ADD COLUMN "candidateCharacterId" TEXT;
ALTER TABLE "LootSessionAward" ADD COLUMN "winnerCharacterId" TEXT;

-- A linha de loot tem duas: quem levou, e quem lootou no jogo quando difere.
ALTER TABLE "LootLine" ADD COLUMN "winnerCharacterId" TEXT;
ALTER TABLE "LootLine" ADD COLUMN "looterCharacterId" TEXT;
