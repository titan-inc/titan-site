-- Titan Bet, revisão 17 (D-78): cancelar libera o period. Um period tem no
-- máximo uma rodada NÃO cancelada; a cancelada fica no histórico e deixa o
-- period livre para uma rodada nova.
--
-- O índice novo entra antes de o antigo sair: não há instante sem a garantia
-- (o antigo é mais forte, e nenhuma linha existente viola o novo). A rodada
-- cancelada não volta a ativa (titanbet_rodada_imutavel), então o índice
-- parcial nunca recebe de volta uma linha que o violaria.
CREATE UNIQUE INDEX "BetRound_uma_ativa_por_period" ON "BetRound"("period")
  WHERE "cancelledAt" IS NULL;
DROP INDEX "BetRound_period_key";
