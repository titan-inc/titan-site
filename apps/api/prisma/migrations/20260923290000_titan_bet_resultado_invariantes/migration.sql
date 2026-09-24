-- Titan Bet — invariantes do resultado da auditoria (§16.4; T-X01–T-X07, T-F06).
-- A estrutura veio em 20260923280000_titan_bet_resultado_estrutura; os testes
-- rodaram contra ela e o banco aceitou o que devia recusar (RED).

-- DropForeignKey
ALTER TABLE "BetMarketResult" DROP CONSTRAINT "BetMarketResult_auditId_fkey";

-- DropForeignKey
ALTER TABLE "BetMarketResult" DROP CONSTRAINT "BetMarketResult_marketId_fkey";

-- DropForeignKey
ALTER TABLE "BetMarketResultWinner" DROP CONSTRAINT "BetMarketResultWinner_resultId_fkey";

-- DropForeignKey
ALTER TABLE "BetMarketResultWinner" DROP CONSTRAINT "BetMarketResultWinner_characterId_fkey";

-- DropForeignKey
ALTER TABLE "BetMarketResultKill" DROP CONSTRAINT "BetMarketResultKill_resultId_fkey";

-- DropForeignKey
ALTER TABLE "BetMarketResultKill" DROP CONSTRAINT "BetMarketResultKill_roundEncounterId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "BetRoundEncounter_id_roundId_key" ON "BetRoundEncounter"("id", "roundId");

-- CreateIndex
CREATE UNIQUE INDEX "BetMarket_id_roundId_key" ON "BetMarket"("id", "roundId");

-- CreateIndex
CREATE UNIQUE INDEX "BetAudit_id_roundId_key" ON "BetAudit"("id", "roundId");

-- CreateIndex
CREATE UNIQUE INDEX "BetMarketResult_auditId_marketId_key" ON "BetMarketResult"("auditId", "marketId");

-- CreateIndex
CREATE UNIQUE INDEX "BetMarketResult_id_roundId_key" ON "BetMarketResult"("id", "roundId");

-- AddForeignKey
ALTER TABLE "BetMarketResult" ADD CONSTRAINT "BetMarketResult_auditId_roundId_fkey" FOREIGN KEY ("auditId", "roundId") REFERENCES "BetAudit"("id", "roundId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetMarketResult" ADD CONSTRAINT "BetMarketResult_marketId_roundId_fkey" FOREIGN KEY ("marketId", "roundId") REFERENCES "BetMarket"("id", "roundId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetMarketResultWinner" ADD CONSTRAINT "BetMarketResultWinner_resultId_roundId_fkey" FOREIGN KEY ("resultId", "roundId") REFERENCES "BetMarketResult"("id", "roundId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetMarketResultWinner" ADD CONSTRAINT "BetMarketResultWinner_roundId_characterId_fkey" FOREIGN KEY ("roundId", "characterId") REFERENCES "BetRoundCandidate"("roundId", "characterId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetMarketResultKill" ADD CONSTRAINT "BetMarketResultKill_resultId_roundId_fkey" FOREIGN KEY ("resultId", "roundId") REFERENCES "BetMarketResult"("id", "roundId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetMarketResultKill" ADD CONSTRAINT "BetMarketResultKill_roundEncounterId_roundId_fkey" FOREIGN KEY ("roundEncounterId", "roundId") REFERENCES "BetRoundEncounter"("id", "roundId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Desfecho coerente (T-X03). `vencedores` com W = 0 é o órfão da D-44.
ALTER TABLE "BetMarketResult" ADD CONSTRAINT "BetMarketResult_anulado_tem_motivo"
  CHECK (("outcome" = 'anulado') = ("voidReason" IS NOT NULL));
ALTER TABLE "BetMarketResult" ADD CONSTRAINT "BetMarketResult_pool_do_desfecho"
  CHECK (
    ("outcome" = 'anulado' AND "prizePool" IS NULL AND "winningStake" IS NULL)
    OR ("outcome" = 'vencedores' AND "prizePool" IS NOT NULL AND "winningStake" IS NOT NULL)
  );
ALTER TABLE "BetMarketResult" ADD CONSTRAINT "BetMarketResult_valores_nao_negativos"
  CHECK ("validPool" >= 0 AND COALESCE("prizePool", 0) >= 0 AND COALESCE("winningStake", 0) >= 0);

-- titanbet_resultado_imutavel (T-X06, T-X07): resultado, vencedor e kill só
-- entram com a auditoria `pronta` — o cálculo grava e só então marca
-- `calculada` — e nunca mudam nem somem. Recalcular é outra tentativa (D-30).
CREATE OR REPLACE FUNCTION titanbet_resultado_so_insere() RETURNS trigger AS $$
DECLARE
  situacao "BetAuditStatus";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'titanbet: % é resultado de auditoria — não muda nem se apaga', TG_TABLE_NAME;
  END IF;
  IF TG_TABLE_NAME = 'BetMarketResult' THEN
    SELECT "status" INTO situacao FROM "BetAudit" WHERE "id" = NEW."auditId";
  ELSE
    SELECT a."status" INTO situacao
      FROM "BetMarketResult" r JOIN "BetAudit" a ON a."id" = r."auditId"
      WHERE r."id" = NEW."resultId";
  END IF;
  IF situacao IS DISTINCT FROM 'pronta' THEN
    RAISE EXCEPTION 'titanbet: % só entra com a auditoria pronta (está %)', TG_TABLE_NAME, situacao;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER titanbet_resultado_imutavel BEFORE INSERT OR UPDATE OR DELETE ON "BetMarketResult"
  FOR EACH ROW EXECUTE FUNCTION titanbet_resultado_so_insere();
CREATE TRIGGER titanbet_resultado_imutavel BEFORE INSERT OR UPDATE OR DELETE ON "BetMarketResultWinner"
  FOR EACH ROW EXECUTE FUNCTION titanbet_resultado_so_insere();
CREATE TRIGGER titanbet_resultado_imutavel BEFORE INSERT OR UPDATE OR DELETE ON "BetMarketResultKill"
  FOR EACH ROW EXECUTE FUNCTION titanbet_resultado_so_insere();
