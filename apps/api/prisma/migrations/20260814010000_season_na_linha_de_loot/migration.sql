-- A linha de loot ganha a season em que a entrega ACONTECEU.
--
-- Derivada do `awardedAt`, não do tier da peça: 77 das 294 linhas existentes não
-- têm boss resolvido, então pelo tier um quarto do histórico ficaria sem season
-- e sumiria de todo filtro. Ver TIT-121.

ALTER TABLE "LootLine" ADD COLUMN "seasonId" INTEGER;

ALTER TABLE "LootLine"
  ADD CONSTRAINT "LootLine_seasonId_fkey"
  FOREIGN KEY ("seasonId") REFERENCES "GameSeason"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "LootLine_seasonId_awardedAt_idx" ON "LootLine"("seasonId", "awardedAt");

-- Backfill do histórico já importado.
--
-- Em SQL, e não re-rodando o importador: o arquivo de export vive fora do repo
-- (`localdocs/`), então uma migration que dependesse dele não rodaria em
-- produção. Aqui a regra é a mesma do código — a season mais recente que já
-- havia começado quando a entrega foi feita.
--
-- Linha anterior a qualquer season conhecida fica NULL de propósito: é lacuna, e
-- a Regra 7 manda gravar lacuna em vez de chutar a season mais próxima.
UPDATE "LootLine" l
SET "seasonId" = (
  SELECT s."id"
  FROM "GameSeason" s
  WHERE s."startedAt" <= l."awardedAt"
  ORDER BY s."startedAt" DESC
  LIMIT 1
);
