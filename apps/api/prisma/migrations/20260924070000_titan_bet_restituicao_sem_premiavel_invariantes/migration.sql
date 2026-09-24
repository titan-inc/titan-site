-- Titan Bet, revisão 14 (D-74): as invariantes de `restituicao_sem_premiavel`.

-- Um crédito de resultado por aposta: prêmio, restituição de VOID ou restituição
-- sem premiável — nunca dois, nunca dois tipos para a mesma aposta. O índice
-- novo contém o antigo (mesma coluna, predicado maior); o antigo sai depois, e
-- nenhum instante fica sem a garantia.
CREATE UNIQUE INDEX "GoldLedgerEntry_um_credito_de_resultado_por_aposta" ON "GoldLedgerEntry"("betId")
  WHERE "kind" IN ('premio', 'restituicao_anulado', 'restituicao_sem_premiavel');
DROP INDEX "GoldLedgerEntry_um_resultado_por_aposta";

-- É do membro, e de uma aposta num resultado: a restituição sai do P de um
-- mercado confirmado, para quem apostou nele.
ALTER TABLE "GoldLedgerEntry" ADD CONSTRAINT "GoldLedgerEntry_restituicao_sem_premiavel_completa"
  CHECK (
    "kind" <> 'restituicao_sem_premiavel'
    OR ("account" = 'membro' AND "betId" IS NOT NULL AND "marketId" IS NOT NULL
        AND "resultId" IS NOT NULL)
  );
