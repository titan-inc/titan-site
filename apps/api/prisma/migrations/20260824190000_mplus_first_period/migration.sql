-- O period em que o M+ da season ABRIU, que não é o period do patch (TIT-145).
ALTER TABLE "GameSeason" ADD COLUMN "mplusFirstPeriod" INTEGER;

-- Backfill CONDICIONAL, e a condição é o ponto.
--
-- O sinal disponível é o primeiro period com `mythicPlusScore` gravado — o job
-- só grava score depois que o M+ abre. Mas esse sinal só significa "o M+ abriu
-- aqui" quando a gente já estava fotografando antes: numa season que começou
-- antes do site existir, ele significa apenas "foi quando começamos a olhar".
--
-- Exigir `= firstPeriod + 1` separa os dois casos. Season 18 (patch 1076, score
-- desde 1077) é preenchida; season 17 (patch 1055, score só desde 1074, quando
-- o site passou a fotografar) fica nula e a leitura cai de volta em
-- `firstPeriod` — o mesmo comportamento de antes desta migration.
UPDATE "GameSeason" g
SET "mplusFirstPeriod" = observado.period
FROM (
  SELECT "seasonId", MIN(period) AS period
  FROM "CharacterSnapshot"
  WHERE "mythicPlusScore" IS NOT NULL
  GROUP BY "seasonId"
) AS observado
WHERE g.id = observado."seasonId"
  AND observado.period = g."firstPeriod" + 1;
