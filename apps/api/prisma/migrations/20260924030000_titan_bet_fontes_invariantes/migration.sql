-- Titan Bet — invariantes das fontes da auditoria (T-A16, T-A19; D-60, D-63).
-- A estrutura veio em 20260924020000_titan_bet_fontes_estrutura; os testes
-- rodaram contra ela e o banco aceitou o que devia recusar (RED).

-- CreateIndex
CREATE UNIQUE INDEX "BetAuditSourceReport_sourceId_reportCode_key" ON "BetAuditSourceReport"("sourceId", "reportCode");


-- "Não houve raid oficial" é declaração do officer, com motivo (D-60).
ALTER TABLE "BetAuditSource" ADD CONSTRAINT "BetAuditSource_sem_raid_tem_motivo"
  CHECK (("resolution" = 'sem_raid') = ("noRaidReason" IS NOT NULL));
ALTER TABLE "BetAuditSource" ADD CONSTRAINT "BetAuditSource_sem_raid_tem_officer"
  CHECK (
    "resolution" <> 'sem_raid'
    OR ("resolvedByUserId" IS NOT NULL AND "resolvedByBattletag" IS NOT NULL AND "resolvedAt" IS NOT NULL)
  );

-- Os reports da fonte: só existem em fonte automática — ausente e sem raid não
-- usam report — e ficam imutáveis com a auditoria confirmada ou substituída,
-- como a própria fonte (titanbet_resultado_imutavel, T-A08).
CREATE OR REPLACE FUNCTION titanbet_report_da_fonte() RETURNS trigger AS $$
DECLARE
  fonte_id TEXT;
  v_resolution "BetSourceResolution";
  situacao "BetAuditStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN fonte_id := OLD."sourceId"; ELSE fonte_id := NEW."sourceId"; END IF;
  SELECT f."resolution", a."status" INTO v_resolution, situacao
    FROM "BetAuditSource" f JOIN "BetAudit" a ON a."id" = f."auditId"
    WHERE f."id" = fonte_id;
  IF situacao IN ('confirmada', 'substituida') THEN
    RAISE EXCEPTION 'titanbet: a auditoria está % — os reports da fonte não mudam', situacao;
  END IF;
  IF TG_OP <> 'DELETE' AND v_resolution IS DISTINCT FROM 'automatica' THEN
    RAISE EXCEPTION 'titanbet: fonte % (%) não usa report', fonte_id, v_resolution;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER titanbet_resultado_imutavel BEFORE INSERT OR UPDATE OR DELETE ON "BetAuditSourceReport"
  FOR EACH ROW EXECUTE FUNCTION titanbet_report_da_fonte();
