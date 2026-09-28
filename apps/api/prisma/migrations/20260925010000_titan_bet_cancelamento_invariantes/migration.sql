-- Titan Bet, revisão 16 (D-77): as invariantes do cancelamento administrativo.
-- A estrutura veio em 20260925000000_titan_bet_cancelamento_estrutura; os testes
-- rodaram contra ela e o banco aceitou o que devia recusar (RED).
--
-- Nenhum trigger aqui tem bypass, relógio especial ou caminho de teste. As
-- funções substituídas (CREATE OR REPLACE) mantêm tudo o que já recusavam e
-- acrescentam o cancelamento; nenhuma migration anterior foi editada.

-- ── A rodada cancelada: quem, quando e por quê, juntos e com motivo ─────────

ALTER TABLE "BetRound" ADD CONSTRAINT "BetRound_cancelamento_completo"
  CHECK (
    ("cancelledAt" IS NULL AND "cancelledByUserId" IS NULL
      AND "cancelledByBattletag" IS NULL AND "cancellationReason" IS NULL)
    OR ("cancelledAt" IS NOT NULL AND "cancelledByUserId" IS NOT NULL
      AND "cancelledByBattletag" IS NOT NULL AND "cancellationReason" IS NOT NULL
      -- Mesmo whitespace recusado pelo trim() do contrato HTTP (inclusive NBSP).
      AND btrim("cancellationReason", U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') <> '')
  );

-- A checagem também serializa SQL direto com o cancelamento. VOLATILE permite
-- ler o estado que acabou de ser confirmado depois de esperar o lock.
CREATE FUNCTION titanbet_rodada_cancelada(p_round TEXT) RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_cancelada BOOLEAN;
BEGIN
  SELECT "cancelledAt" IS NOT NULL INTO v_cancelada
    FROM "BetRound" WHERE "id" = p_round FOR SHARE;
  RETURN v_cancelada;
END
$$;

CREATE FUNCTION titanbet_cancelada_nao_apaga() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."cancelledAt" IS NOT NULL THEN
    RAISE EXCEPTION 'titanbet: rodada cancelada não se apaga';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER titanbet_cancelada_nao_apaga BEFORE DELETE ON "BetRound"
  FOR EACH ROW EXECUTE FUNCTION titanbet_cancelada_nao_apaga();

-- A rodada: o que já valia (period, abertura, cutoff e o Ready escritos uma vez)
-- e agora o cancelamento — escrito uma vez, nunca com settlement confirmado, e
-- depois dele nada muda na rodada (D-77).
CREATE OR REPLACE FUNCTION titanbet_rodada_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."cancelledAt" IS NOT NULL THEN
    RAISE EXCEPTION 'titanbet: a rodada % foi cancelada — é terminal e não muda', OLD."id";
  END IF;

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

  IF NEW."cancelledAt" IS NOT NULL THEN
    IF NEW."readyAt" IS DISTINCT FROM OLD."readyAt" THEN
      RAISE EXCEPTION 'titanbet: a rodada % não recebe Ready e cancelamento juntos', OLD."id";
    END IF;
    IF EXISTS (SELECT 1 FROM "BetAudit" WHERE "roundId" = OLD."id" AND "status" = 'confirmada') THEN
      RAISE EXCEPTION 'titanbet: a rodada % tem settlement confirmado — não se cancela', OLD."id";
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- ── Slip: as transições da §16.5, e o cancelamento (D-77) ───────────────────

CREATE OR REPLACE FUNCTION titanbet_slip_transicao() RETURNS trigger LANGUAGE plpgsql AS $$
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

  -- Rodada cancelada (D-77): o único movimento é o do próprio cancelamento —
  -- ativo → cancelado. Nada mais muda num slip dela.
  IF titanbet_rodada_cancelada(OLD."roundId") THEN
    IF v_para = 'cancelado' AND v_de IN ('rascunho', 'aguardando_deposito', 'valido')
       AND (to_jsonb(NEW) - 'status' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'updated_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'titanbet: slip % — a rodada foi cancelada; % → % recusado', OLD."id", v_de, v_para;
  END IF;

  IF NEW."roundId" IS DISTINCT FROM OLD."roundId"
     AND titanbet_rodada_cancelada(NEW."roundId") THEN
    RAISE EXCEPTION 'titanbet: slip não pode ser movido para rodada cancelada';
  END IF;

  IF v_para = 'cancelado' THEN
    RAISE EXCEPTION 'titanbet: slip % — só se cancela com a rodada cancelada (D-77)', OLD."id";
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

-- ── Rodada cancelada não recebe mutação (D-77) ──────────────────────────────
-- Uma função para toda tabela com "roundId". BetEvent fica de fora: a trilha
-- continua registrando (inclusive leituras, D-57).

CREATE FUNCTION titanbet_rodada_ativa() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_round TEXT;
BEGIN
  IF TG_TABLE_NAME = 'BetSlip' AND TG_OP = 'INSERT' THEN
    IF NEW."status" = 'cancelado' THEN
      RAISE EXCEPTION 'titanbet: slip só entra em cancelado pela transição de cancelamento';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN v_round := OLD."roundId"; ELSE v_round := NEW."roundId"; END IF;
  IF titanbet_rodada_cancelada(v_round)
     OR (TG_OP = 'UPDATE' AND titanbet_rodada_cancelada(OLD."roundId")) THEN
    RAISE EXCEPTION 'titanbet: % — a rodada % foi cancelada; nada muda nela', TG_TABLE_NAME, v_round;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER titanbet_rodada_ativa BEFORE INSERT OR DELETE ON "BetSlip"
  FOR EACH ROW EXECUTE FUNCTION titanbet_rodada_ativa();
CREATE TRIGGER titanbet_rodada_ativa BEFORE INSERT ON "BetRoundBettor"
  FOR EACH ROW EXECUTE FUNCTION titanbet_rodada_ativa();
CREATE TRIGGER titanbet_rodada_ativa BEFORE INSERT ON "BetRoundCandidate"
  FOR EACH ROW EXECUTE FUNCTION titanbet_rodada_ativa();
CREATE TRIGGER titanbet_rodada_ativa BEFORE INSERT OR UPDATE OR DELETE ON "Bet"
  FOR EACH ROW EXECUTE FUNCTION titanbet_rodada_ativa();
CREATE TRIGGER titanbet_rodada_ativa BEFORE INSERT OR UPDATE OR DELETE ON "BetRoundEncounter"
  FOR EACH ROW EXECUTE FUNCTION titanbet_rodada_ativa();
CREATE TRIGGER titanbet_rodada_ativa BEFORE INSERT OR UPDATE OR DELETE ON "BetMarket"
  FOR EACH ROW EXECUTE FUNCTION titanbet_rodada_ativa();
CREATE TRIGGER titanbet_rodada_ativa BEFORE INSERT OR UPDATE OR DELETE ON "BetAudit"
  FOR EACH ROW EXECUTE FUNCTION titanbet_rodada_ativa();
CREATE TRIGGER titanbet_rodada_ativa BEFORE INSERT OR UPDATE ON "BetMarketResult"
  FOR EACH ROW EXECUTE FUNCTION titanbet_rodada_ativa();
CREATE TRIGGER titanbet_rodada_ativa BEFORE INSERT ON "BetMarketResultWinner"
  FOR EACH ROW EXECUTE FUNCTION titanbet_rodada_ativa();
CREATE TRIGGER titanbet_rodada_ativa BEFORE INSERT ON "BetMarketResultKill"
  FOR EACH ROW EXECUTE FUNCTION titanbet_rodada_ativa();
CREATE TRIGGER titanbet_rodada_ativa BEFORE INSERT ON "GoldLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION titanbet_rodada_ativa();
CREATE TRIGGER titanbet_rodada_ativa BEFORE INSERT ON "RoundClosingReport"
  FOR EACH ROW EXECUTE FUNCTION titanbet_rodada_ativa();

-- As fontes da auditoria não têm "roundId": a rodada vem pela auditoria.
CREATE FUNCTION titanbet_fonte_rodada_ativa() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_audit TEXT;
  v_round TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN v_audit := OLD."auditId"; ELSE v_audit := NEW."auditId"; END IF;
  SELECT "roundId" INTO v_round FROM "BetAudit" WHERE "id" = v_audit;
  IF titanbet_rodada_cancelada(v_round) THEN
    RAISE EXCEPTION 'titanbet: % — a rodada da auditoria % foi cancelada', TG_TABLE_NAME, v_audit;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT "roundId" INTO v_round FROM "BetAudit" WHERE "id" = OLD."auditId";
    IF titanbet_rodada_cancelada(v_round) THEN
      RAISE EXCEPTION 'titanbet: fonte de rodada cancelada não muda de auditoria';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER titanbet_rodada_ativa BEFORE INSERT OR UPDATE OR DELETE ON "BetAuditSource"
  FOR EACH ROW EXECUTE FUNCTION titanbet_fonte_rodada_ativa();

CREATE FUNCTION titanbet_report_rodada_ativa() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_source TEXT;
  v_round TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN v_source := OLD."sourceId"; ELSE v_source := NEW."sourceId"; END IF;
  SELECT a."roundId" INTO v_round FROM "BetAuditSource" s
    JOIN "BetAudit" a ON a."id" = s."auditId"
    WHERE s."id" = v_source;
  IF titanbet_rodada_cancelada(v_round) THEN
    RAISE EXCEPTION 'titanbet: % — a rodada da fonte % foi cancelada', TG_TABLE_NAME, v_source;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT a."roundId" INTO v_round FROM "BetAuditSource" s
      JOIN "BetAudit" a ON a."id" = s."auditId" WHERE s."id" = OLD."sourceId";
    IF titanbet_rodada_cancelada(v_round) THEN
      RAISE EXCEPTION 'titanbet: report de rodada cancelada não muda de fonte';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER titanbet_rodada_ativa BEFORE INSERT OR UPDATE OR DELETE ON "BetAuditSourceReport"
  FOR EACH ROW EXECUTE FUNCTION titanbet_report_rodada_ativa();
