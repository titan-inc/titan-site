-- Titan Bet — invariantes da Weekly por boss (T-W14) e do sem_vencedor (T-M17).
-- A estrutura veio em 20260924000000_titan_bet_weekly_por_boss_estrutura; os testes
-- rodaram contra ela e o banco aceitou o que devia recusar (RED).

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_targetEncounterId_roundId_targetEncounterTrack_fkey" FOREIGN KEY ("targetEncounterId", "roundId", "targetEncounterTrack") REFERENCES "BetRoundEncounter"("id", "roundId", "track") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A Weekly aposta num boss; os outros mercados, num personagem (D-54).
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_weekly_tem_boss"
  CHECK (("marketKind" = 'weekly_progression') = ("targetEncounterId" IS NOT NULL));
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_boss_com_track"
  CHECK (("targetEncounterId" IS NULL) = ("targetEncounterTrack" IS NULL));
-- Farm fica fora da Weekly: o boss apostado é de progressão, e a FK composta
-- confere que ele é mesmo, nesta rodada.
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_boss_de_progressao"
  CHECK ("targetEncounterTrack" IS NULL OR "targetEncounterTrack" = 'progressao');

-- Desfecho (D-61): sem_vencedor tem V e P — o P é redistribuído — e W = 0.
ALTER TABLE "BetMarketResult" DROP CONSTRAINT "BetMarketResult_pool_do_desfecho";
ALTER TABLE "BetMarketResult" ADD CONSTRAINT "BetMarketResult_pool_do_desfecho"
  CHECK (
    ("outcome" = 'anulado' AND "prizePool" IS NULL AND "winningStake" IS NULL)
    OR ("outcome" = 'vencedores' AND "prizePool" IS NOT NULL AND "winningStake" IS NOT NULL)
    OR ("outcome" = 'sem_vencedor' AND "prizePool" IS NOT NULL AND "winningStake" = 0)
  );
