-- Titan Bet — Round Closing Report imutável e versionado (T-C02; §16.4, §16.7).
-- A estrutura veio em 20260923300000_titan_bet_closing_estrutura; os testes
-- rodaram contra ela e o banco aceitou o que devia recusar (RED).

-- DropForeignKey
ALTER TABLE "RoundClosingReport" DROP CONSTRAINT "RoundClosingReport_auditId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "RoundClosingReport_roundId_version_key" ON "RoundClosingReport"("roundId", "version");

-- AddForeignKey
ALTER TABLE "RoundClosingReport" ADD CONSTRAINT "RoundClosingReport_auditId_roundId_fkey" FOREIGN KEY ("auditId", "roundId") REFERENCES "BetAudit"("id", "roundId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Append-only, como o ledger e o BetEvent: reusa a função de 20260923220000.
CREATE TRIGGER titanbet_append_only BEFORE UPDATE OR DELETE ON "RoundClosingReport"
  FOR EACH ROW EXECUTE FUNCTION titanbet_append_only();
CREATE TRIGGER titanbet_append_only_truncate BEFORE TRUNCATE ON "RoundClosingReport"
  FOR EACH STATEMENT EXECUTE FUNCTION titanbet_append_only();
