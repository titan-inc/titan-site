-- Slug do Raider.IO na season, para separar "season publicada" de "M+ aberto".
--
-- A season de M+ abre UMA SEMANA DEPOIS DO PATCH. Nesse intervalo a Blizzard
-- já publicou a season nova e o Raider.IO ainda responde a anterior. Em
-- 11/08/2026 isso gravou o acumulado da 12.0 carimbado como 12.1 — o period
-- fecharia com número de outra season dentro dele, e não haveria como
-- descobrir depois qual era qual.
--
-- Nulo significa "o M+ desta season ainda não abriu". Nesse estado o snapshot
-- grava lacuna em vez de número da season anterior.
ALTER TABLE "GameSeason" ADD COLUMN "raiderioSlug" TEXT;

-- Um slug pertence a exatamente uma season. É essa unicidade que deixa a
-- pergunta "este slug já é de uma season mais antiga?" ser respondida no banco.
CREATE UNIQUE INDEX "GameSeason_raiderioSlug_key" ON "GameSeason"("raiderioSlug");

-- A season 17 (patch 12.0) é a `season-mn-1`, lido do perfil dos personagens do
-- time em 11/08/2026.
--
-- Semear é necessário: sem esta linha, a primeira rodada com a coluna vazia
-- veria `season-mn-1` sem dono e o adotaria na season 18 — deixando passar
-- exatamente o intervalo que motivou a coluna. Em banco de desenvolvimento sem
-- a season 17 o UPDATE não afeta linha nenhuma, que é o correto.
UPDATE "GameSeason" SET "raiderioSlug" = 'season-mn-1' WHERE id = 17;
