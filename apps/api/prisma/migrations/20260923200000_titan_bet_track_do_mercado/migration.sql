-- Titan Bet — o track do mercado anda junto com o encounter (T-R17).
--
-- A FK composta "BetMarket_roundEncounterId_roundId_track_fkey" é MATCH SIMPLE:
-- com qualquer coluna NULL o Postgres não confere nada. Sem este CHECK, um
-- mercado de boss com track NULL escaparia da conferência contra o encounter —
-- e, com ela, do "boss em progressão só tem First Death" (R-22 × R-24).
ALTER TABLE "BetMarket" ADD CONSTRAINT "BetMarket_track_com_encounter"
  CHECK (("roundEncounterId" IS NULL) = ("track" IS NULL));
