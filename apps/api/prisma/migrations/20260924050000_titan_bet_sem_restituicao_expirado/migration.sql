-- Titan Bet, revisão 12 (D-67): slip que nunca chegou a `valido` — recusado ou
-- expirado — não tem restituição no ledger. Devolver gold depositado é
-- operação dos officers, fora do Titan Bet; o sistema só encerra o slip.
--
-- Aditivo: o valor `restituicao_expirado` continua no enum (nenhuma migration
-- é reescrita) e o CHECK é NOT VALID — não reavalia o histórico, só recusa
-- lançamento novo.
ALTER TABLE "GoldLedgerEntry"
  ADD CONSTRAINT "GoldLedgerEntry_sem_restituicao_expirado"
  CHECK ("kind" <> 'restituicao_expirado') NOT VALID;
