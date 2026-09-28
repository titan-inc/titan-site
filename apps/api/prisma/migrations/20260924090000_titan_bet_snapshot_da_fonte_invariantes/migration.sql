-- Titan Bet, revisão 15 (D-76): as invariantes do snapshot da fonte. A
-- estrutura veio em 20260924080000_titan_bet_snapshot_da_fonte_estrutura; os
-- testes rodaram contra ela e o banco aceitou o que devia recusar (RED).

-- Referência nova sempre com o snapshot: o Calcular não tem outra fonte.
-- NOT VALID: as referências anteriores à revisão 15 não são reavaliadas —
-- continuam sem snapshot, e nenhum é fabricado para elas.
ALTER TABLE "BetAuditSourceReport" ADD CONSTRAINT "BetAuditSourceReport_snapshot_obrigatorio"
  CHECK ("snapshot" IS NOT NULL) NOT VALID;

-- Proveniência: o snapshot é deste report, nesta revisão, no formato 1.
ALTER TABLE "BetAuditSourceReport" ADD CONSTRAINT "BetAuditSourceReport_snapshot_da_referencia"
  CHECK (
    "snapshot" IS NULL
    OR ("snapshot" -> 'versao' = '1'::jsonb
        AND "snapshot" -> 'code' = to_jsonb("reportCode")
        AND "snapshot" -> 'revision' = to_jsonb("reportRevision"))
  );

-- Imutável: referência com snapshot não muda nem some, e referência sem
-- snapshot não ganha um depois — congelar é no Auditar, nunca retroativo.
CREATE FUNCTION titanbet_snapshot_da_fonte_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."snapshot" IS NOT NULL THEN
    RAISE EXCEPTION 'titanbet: o snapshot do report % foi congelado no Auditar — % recusado',
      OLD."reportCode", TG_OP;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."snapshot" IS NOT NULL THEN
    RAISE EXCEPTION 'titanbet: referência % é anterior ao congelamento — snapshot não se fabrica depois',
      OLD."reportCode";
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER titanbet_snapshot_da_fonte_imutavel BEFORE UPDATE OR DELETE ON "BetAuditSourceReport"
  FOR EACH ROW EXECUTE FUNCTION titanbet_snapshot_da_fonte_imutavel();
