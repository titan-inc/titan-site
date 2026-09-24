-- Titan Bet — BetEvent é append-only (T-E01; §16.4, D-39).
-- Reusa a função do ledger (20260923220000_titan_bet_imutabilidade).

CREATE TRIGGER titanbet_append_only BEFORE UPDATE OR DELETE ON "BetEvent"
  FOR EACH ROW EXECUTE FUNCTION titanbet_append_only();
CREATE TRIGGER titanbet_append_only_truncate BEFORE TRUNCATE ON "BetEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION titanbet_append_only();
