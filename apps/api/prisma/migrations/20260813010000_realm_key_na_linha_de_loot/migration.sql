-- Realm da linha de loot passa a ser a chave FROUXA (toRealmMatchKey), igual ao
-- Attendance.realmKey.
--
-- Motivo: o export do RCLootCouncil escreve realm à moda do cliente do jogo
-- ("Area52", "DemonSoul"), e o roster da Blizzard guarda "area-52"/"demon-soul".
-- Com toSlug() nos dois lados o casamento falharia em silêncio e o histórico da
-- pessoa apareceria partido em dois.
--
-- RENAME e não DROP/ADD: a tabela está vazia hoje, mas rename é reversível e não
-- depende disso ser verdade no ambiente onde a migration rodar.

ALTER TABLE "LootLine" RENAME COLUMN "winnerRealmSlug" TO "winnerRealmKey";
ALTER TABLE "LootLine" RENAME COLUMN "looterRealmSlug" TO "looterRealmKey";

-- O índice da consulta central da Regra 7 ("o histórico desta pessoa") segue a
-- coluna renomeada; o nome do índice é recriado para não mentir sobre o conteúdo.
ALTER INDEX "LootLine_winnerNameKey_winnerRealmSlug_awardedAt_idx"
  RENAME TO "LootLine_winnerNameKey_winnerRealmKey_awardedAt_idx";
