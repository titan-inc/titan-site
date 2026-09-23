-- Titan Bet — invariantes do Auditar (§16.4; T-A06, T-A07, T-A08, T-A11).
-- A estrutura veio em 20260923250000_titan_bet_auditoria_estrutura; os testes
-- rodaram contra ela e o banco aceitou o que devia recusar (RED).

-- Uma fonte por sessão por tentativa (T-A11). A sessão só tem dois valores
-- pelo enum; o unique garante que cada um aparece no máximo uma vez.
CREATE UNIQUE INDEX "BetAuditSource_auditId_session_key" ON "BetAuditSource"("auditId", "session");

-- Uma auditoria confirmada por rodada (T-A07).
CREATE UNIQUE INDEX "BetAudit_uma_confirmada_por_rodada" ON "BetAudit"("roundId")
  WHERE "status" = 'confirmada';

-- Fonte usada ⇔ referência ao report, inteira (T-A06, T-A12). `ausente` e
-- `ambigua` não usam report nenhum; o que o WCL achou fica em `candidates`.
ALTER TABLE "BetAuditSource" ADD CONSTRAINT "BetAuditSource_fonte_usada_tem_report"
  CHECK (("resolution" IN ('automatica', 'escolha_officer')) = ("reportCode" IS NOT NULL));
ALTER TABLE "BetAuditSource" ADD CONSTRAINT "BetAuditSource_referencia_inteira"
  CHECK (
    ("reportCode" IS NULL AND "reportTitle" IS NULL AND "reportRevision" IS NULL AND "reportStartTime" IS NULL)
    OR ("reportCode" IS NOT NULL AND "reportTitle" IS NOT NULL AND "reportRevision" IS NOT NULL AND "reportStartTime" IS NOT NULL)
  );

-- Escolha do officer tem officer e horário (D-25).
ALTER TABLE "BetAuditSource" ADD CONSTRAINT "BetAuditSource_escolha_tem_officer"
  CHECK (
    "resolution" <> 'escolha_officer'
    OR ("resolvedByUserId" IS NOT NULL AND "resolvedByBattletag" IS NOT NULL AND "resolvedAt" IS NOT NULL)
  );

-- titanbet_resultado_imutavel (T-A08): tentativa confirmada — ou substituída,
-- que também é terminal (T-A09) — não muda, não se apaga, e suas fontes não
-- mudam, não se apagam, nem ganham irmã. Sem bypass.
CREATE OR REPLACE FUNCTION titanbet_auditoria_encerrada() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('confirmada', 'substituida') THEN
    RAISE EXCEPTION 'titanbet: a auditoria % está % e não muda', OLD."id", OLD."status";
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER titanbet_resultado_imutavel BEFORE UPDATE OR DELETE ON "BetAudit"
  FOR EACH ROW EXECUTE FUNCTION titanbet_auditoria_encerrada();

CREATE OR REPLACE FUNCTION titanbet_fonte_da_auditoria_aberta() RETURNS trigger AS $$
DECLARE
  auditoria_id TEXT;
  situacao "BetAuditStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN auditoria_id := OLD."auditId"; ELSE auditoria_id := NEW."auditId"; END IF;
  SELECT "status" INTO situacao FROM "BetAudit" WHERE "id" = auditoria_id;
  IF situacao IN ('confirmada', 'substituida') THEN
    RAISE EXCEPTION 'titanbet: a auditoria % está % — suas fontes não mudam', auditoria_id, situacao;
  END IF;
  -- Mudar a fonte de auditoria também é mudar de auditoria: a de origem conta.
  IF TG_OP = 'UPDATE' AND NEW."auditId" <> OLD."auditId" THEN
    SELECT "status" INTO situacao FROM "BetAudit" WHERE "id" = OLD."auditId";
    IF situacao IN ('confirmada', 'substituida') THEN
      RAISE EXCEPTION 'titanbet: a auditoria % está % — suas fontes não mudam', OLD."auditId", situacao;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER titanbet_resultado_imutavel BEFORE INSERT OR UPDATE OR DELETE ON "BetAuditSource"
  FOR EACH ROW EXECUTE FUNCTION titanbet_fonte_da_auditoria_aberta();
