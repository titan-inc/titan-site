-- A colagem crua na sessão, e o looter virando identidade.
--
-- As duas juntas de propósito: o `looter` do item só pode virar identidade sem
-- perda porque a colagem passa a ficar guardada. Antes, a grafia que o addon
-- escreveu era a única cópia dela — resolvê-la para identidade jogaria fora a
-- pista que sobra quando o nome não casa com ninguém.
--
-- Mesmo instinto do `itemString` guardado inteiro e sem interpretar: grava o
-- fato, interpreta depois (Regra 7).

ALTER TABLE "LootSession" ADD COLUMN "rawPaste" TEXT;

-- O looter das sessões que já existem vira identidade pelo nome que está lá.
-- `realm` vazio acontece: a colagem nem sempre traz o realm do looter, e nesse
-- caso não há identidade para resolver — a coluna fica nula, que é a lacuna
-- honesta.
ALTER TABLE "LootSessionItem" ADD COLUMN "looterCharacterId" TEXT;

INSERT INTO "Character" ("id", "nameKey", "realmKey", "name", "realm", "updated_at")
SELECT DISTINCT ON (lower("looterName"), regexp_replace(lower("looterRealm"), '[^a-z0-9]', '', 'g'))
       gen_random_uuid()::text,
       lower("looterName"),
       regexp_replace(lower("looterRealm"), '[^a-z0-9]', '', 'g'),
       "looterName",
       "looterRealm",
       CURRENT_TIMESTAMP
FROM "LootSessionItem"
WHERE "looterName" <> '' AND "looterRealm" <> ''
ON CONFLICT ("nameKey", "realmKey") DO NOTHING;

UPDATE "LootSessionItem" t SET "looterCharacterId" = c."id"
FROM "Character" c
WHERE c."nameKey" = lower(t."looterName")
  AND c."realmKey" = regexp_replace(lower(t."looterRealm"), '[^a-z0-9]', '', 'g');

ALTER TABLE "LootSessionItem" DROP COLUMN "looterName", DROP COLUMN "looterRealm";

ALTER TABLE "LootSessionItem" ADD CONSTRAINT "LootSessionItem_looterCharacterId_fkey"
  FOREIGN KEY ("looterCharacterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
