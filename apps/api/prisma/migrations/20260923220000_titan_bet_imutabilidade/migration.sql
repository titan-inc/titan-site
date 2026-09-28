-- Titan Bet — imutabilidade no banco (GREEN-M2C).
-- Ver docs/specs/titan-bet.md §16.4 (D-31, D-34, D-35, D-37, D-39) e
-- titan-bet-test-design.md §12.
--
-- Os triggers levantam RAISE EXCEPTION (SQLSTATE P0001). Nenhum tem bypass,
-- relógio especial ou caminho de teste: o tempo é o now() do servidor contra
-- o cutoffAt da rodada.

-- ── A rodada: period, abertura e cutoff não mudam; o Ready é escrito uma vez ──

CREATE FUNCTION titanbet_rodada_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."period" <> OLD."period"
     OR NEW."opensAt" <> OLD."opensAt"
     OR NEW."cutoffAt" <> OLD."cutoffAt" THEN
    RAISE EXCEPTION 'titanbet: period, abertura e cutoff da rodada % não mudam', OLD."id";
  END IF;

  IF OLD."readyAt" IS NOT NULL AND (
       NEW."readyAt" IS DISTINCT FROM OLD."readyAt"
       OR NEW."readyByUserId" IS DISTINCT FROM OLD."readyByUserId"
       OR NEW."readyByBattletag" IS DISTINCT FROM OLD."readyByBattletag") THEN
    RAISE EXCEPTION 'titanbet: o Ready da rodada % já foi dado e não se desfaz', OLD."id";
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER titanbet_rodada_imutavel BEFORE UPDATE ON "BetRound"
  FOR EACH ROW EXECUTE FUNCTION titanbet_rodada_imutavel();

-- ── Configuração: encounters e mercados só mudam em PREPARATION (D-31) ────────

CREATE FUNCTION titanbet_rodada_pronta(p_round TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT "readyAt" IS NOT NULL FROM "BetRound" WHERE "id" = p_round
$$;

CREATE FUNCTION titanbet_config_congelada() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP <> 'INSERT' AND titanbet_rodada_pronta(OLD."roundId"))
     OR (TG_OP <> 'DELETE' AND titanbet_rodada_pronta(NEW."roundId")) THEN
    RAISE EXCEPTION 'titanbet: % — a configuração da rodada congelou no Ready', TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER titanbet_config_congelada BEFORE INSERT OR UPDATE OR DELETE ON "BetRoundEncounter"
  FOR EACH ROW EXECUTE FUNCTION titanbet_config_congelada();
CREATE TRIGGER titanbet_config_congelada BEFORE INSERT OR UPDATE OR DELETE ON "BetMarket"
  FOR EACH ROW EXECUTE FUNCTION titanbet_config_congelada();

-- ── Snapshots: nascem antes do Ready e nunca mudam (D-32, D-33) ──────────────

CREATE FUNCTION titanbet_snapshot_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'titanbet: % é snapshot — não se altera nem se apaga', TG_TABLE_NAME;
  END IF;
  IF titanbet_rodada_pronta(NEW."roundId") THEN
    RAISE EXCEPTION 'titanbet: % — o snapshot congelou no Ready', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER titanbet_snapshot_imutavel BEFORE INSERT OR UPDATE OR DELETE ON "BetRoundBettor"
  FOR EACH ROW EXECUTE FUNCTION titanbet_snapshot_imutavel();
CREATE TRIGGER titanbet_snapshot_imutavel BEFORE INSERT OR UPDATE OR DELETE ON "BetRoundCandidate"
  FOR EACH ROW EXECUTE FUNCTION titanbet_snapshot_imutavel();

-- ── Slip: só nasce com a rodada aberta e antes do cutoff (D-31, D-35) ────────

CREATE FUNCTION titanbet_antes_do_cutoff(p_round TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT now() < "cutoffAt" FROM "BetRound" WHERE "id" = p_round
$$;

CREATE FUNCTION titanbet_slip_aberto() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF titanbet_rodada_pronta(NEW."roundId") IS NOT TRUE THEN
    RAISE EXCEPTION 'titanbet: a rodada % ainda não teve Ready — apostas fechadas', NEW."roundId";
  END IF;
  IF titanbet_antes_do_cutoff(NEW."roundId") IS NOT TRUE THEN
    RAISE EXCEPTION 'titanbet: a rodada % passou do cutoff — apostas encerradas', NEW."roundId";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER titanbet_slip_aberto BEFORE INSERT ON "BetSlip"
  FOR EACH ROW EXECUTE FUNCTION titanbet_slip_aberto();

-- ── Slip: só as transições da §16.5; o que o submit congela não muda ─────────

CREATE FUNCTION titanbet_slip_transicao() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_de   TEXT := OLD."status"::TEXT;
  v_para TEXT := NEW."status"::TEXT;
BEGIN
  -- Colunas escritas uma vez: o slip freeze e quem confirmou, recusou ou expirou.
  IF (OLD."submittedAt" IS NOT NULL AND NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt")
     OR (OLD."expectedTotal" IS NOT NULL AND NEW."expectedTotal" IS DISTINCT FROM OLD."expectedTotal")
     OR (OLD."depositCharacterId" IS NOT NULL AND NEW."depositCharacterId" IS DISTINCT FROM OLD."depositCharacterId")
     OR (OLD."validatedAt" IS NOT NULL AND NEW."validatedAt" IS DISTINCT FROM OLD."validatedAt")
     OR (OLD."validatedByUserId" IS NOT NULL AND NEW."validatedByUserId" IS DISTINCT FROM OLD."validatedByUserId")
     OR (OLD."validatedByBattletag" IS NOT NULL AND NEW."validatedByBattletag" IS DISTINCT FROM OLD."validatedByBattletag")
     OR (OLD."rejectedAt" IS NOT NULL AND NEW."rejectedAt" IS DISTINCT FROM OLD."rejectedAt")
     OR (OLD."rejectedByUserId" IS NOT NULL AND NEW."rejectedByUserId" IS DISTINCT FROM OLD."rejectedByUserId")
     OR (OLD."rejectedByBattletag" IS NOT NULL AND NEW."rejectedByBattletag" IS DISTINCT FROM OLD."rejectedByBattletag")
     OR (OLD."rejectionReason" IS NOT NULL AND NEW."rejectionReason" IS DISTINCT FROM OLD."rejectionReason")
     OR (OLD."expiredAt" IS NOT NULL AND NEW."expiredAt" IS DISTINCT FROM OLD."expiredAt") THEN
    RAISE EXCEPTION 'titanbet: slip % — campo já gravado não muda', OLD."id";
  END IF;

  IF v_de = v_para THEN
    RETURN NEW;
  END IF;

  -- O cutoff expira o que não foi confirmado (D-07, D-35).
  IF (v_de, v_para) IN (('rascunho', 'expirado'), ('aguardando_deposito', 'expirado')) THEN
    RETURN NEW;
  END IF;

  -- Submeter, confirmar e recusar só antes do cutoff.
  IF (v_de, v_para) IN (('rascunho', 'aguardando_deposito'),
                        ('aguardando_deposito', 'valido'),
                        ('aguardando_deposito', 'recusado')) THEN
    IF titanbet_antes_do_cutoff(NEW."roundId") IS NOT TRUE THEN
      RAISE EXCEPTION 'titanbet: slip % — % → % só antes do cutoff', OLD."id", v_de, v_para;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'titanbet: slip % — transição % → % não existe', OLD."id", v_de, v_para;
END $$;

CREATE TRIGGER titanbet_slip_transicao BEFORE UPDATE ON "BetSlip"
  FOR EACH ROW EXECUTE FUNCTION titanbet_slip_transicao();

-- ── Apostas: só mudam com o slip em rascunho e antes do cutoff (D-27, D-35) ──

CREATE FUNCTION titanbet_slip_editavel(p_slip TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT s."status" = 'rascunho' AND now() < r."cutoffAt"
  FROM "BetSlip" s JOIN "BetRound" r ON r."id" = s."roundId"
  WHERE s."id" = p_slip
$$;

CREATE FUNCTION titanbet_aposta_editavel() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_slips TEXT[] := ARRAY[]::TEXT[];
  v_slip  TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Bet' THEN
    IF TG_OP <> 'INSERT' THEN v_slips := v_slips || OLD."slipId"; END IF;
    IF TG_OP <> 'DELETE' THEN v_slips := v_slips || NEW."slipId"; END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      v_slips := v_slips || ARRAY(SELECT b."slipId" FROM "Bet" b WHERE b."id" = OLD."betId");
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_slips := v_slips || ARRAY(SELECT b."slipId" FROM "Bet" b WHERE b."id" = NEW."betId");
    END IF;
  END IF;

  FOREACH v_slip IN ARRAY v_slips LOOP
    -- Slip ou aposta que não existe fica para a FK responder; aqui só se recusa
    -- slip existente que não está mais editável.
    IF titanbet_slip_editavel(v_slip) IS FALSE THEN
      RAISE EXCEPTION 'titanbet: % — o slip % não está mais em rascunho antes do cutoff', TG_TABLE_NAME, v_slip;
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER titanbet_aposta_editavel BEFORE INSERT OR UPDATE OR DELETE ON "Bet"
  FOR EACH ROW EXECUTE FUNCTION titanbet_aposta_editavel();
CREATE TRIGGER titanbet_aposta_editavel BEFORE INSERT OR UPDATE OR DELETE ON "BetWeeklySelection"
  FOR EACH ROW EXECUTE FUNCTION titanbet_aposta_editavel();

-- ── Ledger: a única fonte financeira é append-only (D-37, D-39) ──────────────

CREATE FUNCTION titanbet_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'titanbet: % é append-only — % recusado', TG_TABLE_NAME, TG_OP;
END $$;

CREATE TRIGGER titanbet_append_only BEFORE UPDATE OR DELETE ON "GoldLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION titanbet_append_only();
CREATE TRIGGER titanbet_append_only_truncate BEFORE TRUNCATE ON "GoldLedgerEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION titanbet_append_only();

-- Forma dos lançamentos (§16.4).
ALTER TABLE "GoldLedgerEntry" ADD CONSTRAINT "GoldLedgerEntry_valor_conforme_tipo"
  CHECK (("kind" = 'ajuste' AND "amount" <> 0) OR ("kind" <> 'ajuste' AND "amount" > 0));
ALTER TABLE "GoldLedgerEntry" ADD CONSTRAINT "GoldLedgerEntry_ajuste_completo"
  CHECK ("kind" <> 'ajuste' OR ("correctsEntryId" IS NOT NULL AND "reason" IS NOT NULL
         AND "actorUserId" IS NOT NULL AND "actorBattletag" IS NOT NULL));
ALTER TABLE "GoldLedgerEntry" ADD CONSTRAINT "GoldLedgerEntry_conta_do_membro_com_slip"
  CHECK (("account" = 'membro') = ("slipId" IS NOT NULL));
ALTER TABLE "GoldLedgerEntry" ADD CONSTRAINT "GoldLedgerEntry_pagamento_completo"
  CHECK ("kind" <> 'pagamento' OR ("coversThroughEntryId" IS NOT NULL
         AND "actorUserId" IS NOT NULL AND "actorBattletag" IS NOT NULL));

-- Idempotência (§16.4): a mesma operação financeira não se grava duas vezes.
CREATE UNIQUE INDEX "GoldLedgerEntry_um_resultado_por_aposta" ON "GoldLedgerEntry"("betId")
  WHERE "kind" IN ('premio', 'restituicao_anulado');
CREATE UNIQUE INDEX "GoldLedgerEntry_um_deposito_por_slip" ON "GoldLedgerEntry"("slipId")
  WHERE "kind" = 'deposito_validado';
CREATE UNIQUE INDEX "GoldLedgerEntry_uma_receita_e_um_residuo_por_resultado" ON "GoldLedgerEntry"("resultId", "kind")
  WHERE "kind" IN ('receita_guilda', 'residuo_guilda');
