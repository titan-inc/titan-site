-- Identidade de personagem, passo 2 de 3: BACKFILL.
--
-- ## Por que isto não precisa re-normalizar nada
--
-- As chaves já estão gravadas, e são as mesmas duas de sempre:
--
--   * `nameKey` é `toCharacterKey()` em toda tabela — mesmo valor, mesma função.
--   * o realm aparece em duas formas: `realmKey` (chave frouxa, `area52`) numas
--     tabelas e `realmSlug` (`area-52`) noutras.
--
-- E `toRealmMatchKey()` é literalmente `toSlug()` seguido de tirar tudo que não
-- é letra ou número. Como o slug JÁ é minúsculo e sem acento, tirar separador
-- dele dá exatamente a chave — sem precisar de `unaccent` nem de recriar a
-- normalização em SQL, que é onde este backfill poderia inventar uma pessoa
-- nova sem ninguém perceber.
--
-- Conferido no banco antes de escrever: os três formatos batem com o esperado.
--
-- ## Precedência da grafia: a Blizzard vence
--
-- O roster entra primeiro e é o único que sobrescreve o nome no fim. As demais
-- fontes só criam identidade que ainda não existe. É a mesma regra que o
-- `OfficerGrant` já seguia ao gravar a grafia da Blizzard, e não a digitada.
--
-- O `id` sai de `gen_random_uuid()` porque `cuid()` é do Prisma e não existe no
-- banco. Formato diferente das linhas criadas pela aplicação, mesmo papel.

-- 1. O roster primeiro. `realmSlug` é a única grafia de realm que ele tem, e
--    serve de exibição até outra fonte melhor aparecer.
INSERT INTO "Character" ("id", "nameKey", "realmKey", "name", "realm", "updated_at")
SELECT gen_random_uuid()::text,
       "nameKey",
       regexp_replace("realmSlug", '[^a-z0-9]', '', 'g'),
       "name",
       "realmSlug",
       CURRENT_TIMESTAMP
FROM "GuildCharacter"
ON CONFLICT ("nameKey", "realmKey") DO NOTHING;

-- 2. As fontes que têm grafia de realm de verdade ("Azralon", "Area 52").
INSERT INTO "Character" ("id", "nameKey", "realmKey", "name", "realm", "updated_at")
SELECT DISTINCT ON ("nameKey", "realmKey")
       gen_random_uuid()::text, "nameKey", "realmKey", "name", "realm", CURRENT_TIMESTAMP
FROM "RaidAttendance"
ON CONFLICT ("nameKey", "realmKey") DO NOTHING;

INSERT INTO "Character" ("id", "nameKey", "realmKey", "name", "realm", "class", "updated_at")
SELECT DISTINCT ON ("winnerNameKey", "winnerRealmKey")
       gen_random_uuid()::text, "winnerNameKey", "winnerRealmKey", "winnerName", "winnerRealm",
       "winnerClass", CURRENT_TIMESTAMP
FROM "LootLine"
ON CONFLICT ("nameKey", "realmKey") DO NOTHING;

INSERT INTO "Character" ("id", "nameKey", "realmKey", "name", "realm", "updated_at")
SELECT DISTINCT ON ("looterNameKey", "looterRealmKey")
       gen_random_uuid()::text, "looterNameKey", "looterRealmKey", "looterName", "looterRealm",
       CURRENT_TIMESTAMP
FROM "LootLine"
WHERE "looterNameKey" IS NOT NULL AND "looterRealmKey" IS NOT NULL
ON CONFLICT ("nameKey", "realmKey") DO NOTHING;

INSERT INTO "Character" ("id", "nameKey", "realmKey", "name", "realm", "updated_at")
SELECT DISTINCT ON ("nameKey", "realmKey")
       gen_random_uuid()::text, "nameKey", "realmKey", "name", "realm", CURRENT_TIMESTAMP
FROM "LootSessionResponse"
ON CONFLICT ("nameKey", "realmKey") DO NOTHING;

INSERT INTO "Character" ("id", "nameKey", "realmKey", "name", "realm", "updated_at")
SELECT DISTINCT ON ("nameKey", "realmKey")
       gen_random_uuid()::text, "nameKey", "realmKey", "name", "realm", CURRENT_TIMESTAMP
FROM "LootSessionParticipant"
ON CONFLICT ("nameKey", "realmKey") DO NOTHING;

INSERT INTO "Character" ("id", "nameKey", "realmKey", "name", "realm", "updated_at")
SELECT DISTINCT ON ("winnerNameKey", "winnerRealmKey")
       gen_random_uuid()::text, "winnerNameKey", "winnerRealmKey", "winnerName", "winnerRealm",
       CURRENT_TIMESTAMP
FROM "LootSessionAward"
ON CONFLICT ("nameKey", "realmKey") DO NOTHING;

INSERT INTO "Character" ("id", "nameKey", "realmKey", "name", "realm", "updated_at")
SELECT DISTINCT ON ("nameKey", "realmSlug")
       gen_random_uuid()::text,
       "nameKey",
       regexp_replace("realmSlug", '[^a-z0-9]', '', 'g'),
       "name",
       "realmSlug",
       CURRENT_TIMESTAMP
FROM "CharacterSnapshot"
ON CONFLICT ("nameKey", "realmKey") DO NOTHING;

INSERT INTO "Character" ("id", "nameKey", "realmKey", "name", "realm", "updated_at")
SELECT DISTINCT ON ("nameKey", "realmSlug")
       gen_random_uuid()::text,
       "nameKey",
       regexp_replace("realmSlug", '[^a-z0-9]', '', 'g'),
       "name",
       "realm",
       CURRENT_TIMESTAMP
FROM "OfficerGrant"
ON CONFLICT ("nameKey", "realmKey") DO NOTHING;

-- 3. O voto aponta para um candidato que já respondeu, então a identidade dele
--    já existe. Fica aqui para o caso de dado antigo sem a resposta par.
INSERT INTO "Character" ("id", "nameKey", "realmKey", "name", "realm", "updated_at")
SELECT DISTINCT ON ("candidateNameKey", "candidateRealmKey")
       gen_random_uuid()::text, "candidateNameKey", "candidateRealmKey",
       "candidateNameKey", "candidateRealmKey", CURRENT_TIMESTAMP
FROM "LootSessionVote"
ON CONFLICT ("nameKey", "realmKey") DO NOTHING;

-- 4. A Blizzard vence a grafia do nome.
UPDATE "Character" c
SET "name" = g."name"
FROM "GuildCharacter" g
WHERE c."nameKey" = g."nameKey"
  AND c."realmKey" = regexp_replace(g."realmSlug", '[^a-z0-9]', '', 'g')
  AND c."name" <> g."name";

-- 5. Cada tabela aponta para a identidade.
UPDATE "GuildCharacter" t SET "characterId" = c."id" FROM "Character" c
WHERE c."nameKey" = t."nameKey"
  AND c."realmKey" = regexp_replace(t."realmSlug", '[^a-z0-9]', '', 'g');

UPDATE "OfficerGrant" t SET "characterId" = c."id" FROM "Character" c
WHERE c."nameKey" = t."nameKey"
  AND c."realmKey" = regexp_replace(t."realmSlug", '[^a-z0-9]', '', 'g');

UPDATE "CharacterSnapshot" t SET "characterId" = c."id" FROM "Character" c
WHERE c."nameKey" = t."nameKey"
  AND c."realmKey" = regexp_replace(t."realmSlug", '[^a-z0-9]', '', 'g');

UPDATE "RaidAttendance" t SET "characterId" = c."id" FROM "Character" c
WHERE c."nameKey" = t."nameKey" AND c."realmKey" = t."realmKey";

UPDATE "LootSessionParticipant" t SET "characterId" = c."id" FROM "Character" c
WHERE c."nameKey" = t."nameKey" AND c."realmKey" = t."realmKey";

UPDATE "LootSessionResponse" t SET "characterId" = c."id" FROM "Character" c
WHERE c."nameKey" = t."nameKey" AND c."realmKey" = t."realmKey";

UPDATE "LootSessionVote" t SET "candidateCharacterId" = c."id" FROM "Character" c
WHERE c."nameKey" = t."candidateNameKey" AND c."realmKey" = t."candidateRealmKey";

UPDATE "LootSessionAward" t SET "winnerCharacterId" = c."id" FROM "Character" c
WHERE c."nameKey" = t."winnerNameKey" AND c."realmKey" = t."winnerRealmKey";

UPDATE "LootLine" t SET "winnerCharacterId" = c."id" FROM "Character" c
WHERE c."nameKey" = t."winnerNameKey" AND c."realmKey" = t."winnerRealmKey";

UPDATE "LootLine" t SET "looterCharacterId" = c."id" FROM "Character" c
WHERE c."nameKey" = t."looterNameKey" AND c."realmKey" = t."looterRealmKey";
