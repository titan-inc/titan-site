-- Titan Bet — invariantes do schema central (GREEN-M2B).
-- Ver docs/specs/titan-bet.md §16.4 e titan-bet-test-design.md §10.
--
-- A parte gerada pelo Prisma (UNIQUE e FKs compostas) vem primeiro. Os índices
-- parciais e os CHECKs vêm no fim, escritos à mão: o schema.prisma não os
-- representa.

-- DropForeignKey
ALTER TABLE "BetMarket" DROP CONSTRAINT "BetMarket_roundEncounterId_fkey";

-- DropForeignKey
ALTER TABLE "BetSlip" DROP CONSTRAINT "BetSlip_eligibilityCharacterId_fkey";

-- DropForeignKey
ALTER TABLE "Bet" DROP CONSTRAINT "Bet_slipId_fkey";

-- DropForeignKey
ALTER TABLE "Bet" DROP CONSTRAINT "Bet_marketId_fkey";

-- DropForeignKey
ALTER TABLE "Bet" DROP CONSTRAINT "Bet_targetCharacterId_fkey";

-- DropForeignKey
ALTER TABLE "BetWeeklySelection" DROP CONSTRAINT "BetWeeklySelection_betId_fkey";

-- DropForeignKey
ALTER TABLE "BetWeeklySelection" DROP CONSTRAINT "BetWeeklySelection_roundEncounterId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "BetRound_period_key" ON "BetRound"("period");

-- CreateIndex
CREATE UNIQUE INDEX "BetRoundEncounter_roundId_encounterId_key" ON "BetRoundEncounter"("roundId", "encounterId");

-- CreateIndex
CREATE UNIQUE INDEX "BetRoundEncounter_id_roundId_track_key" ON "BetRoundEncounter"("id", "roundId", "track");

-- CreateIndex
CREATE UNIQUE INDEX "BetRoundEncounter_id_roundId_inWeeklyProgression_key" ON "BetRoundEncounter"("id", "roundId", "inWeeklyProgression");

-- CreateIndex
CREATE UNIQUE INDEX "BetMarket_roundId_kind_roundEncounterId_key" ON "BetMarket"("roundId", "kind", "roundEncounterId");

-- CreateIndex
CREATE UNIQUE INDEX "BetMarket_id_roundId_kind_key" ON "BetMarket"("id", "roundId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "BetRoundBettor_roundId_characterId_key" ON "BetRoundBettor"("roundId", "characterId");

-- CreateIndex
CREATE UNIQUE INDEX "BetRoundCandidate_roundId_characterId_key" ON "BetRoundCandidate"("roundId", "characterId");

-- CreateIndex
CREATE UNIQUE INDEX "BetRoundCandidate_roundId_characterId_role_key" ON "BetRoundCandidate"("roundId", "characterId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "BetSlip_id_roundId_key" ON "BetSlip"("id", "roundId");

-- CreateIndex
CREATE UNIQUE INDEX "Bet_slipId_marketId_key" ON "Bet"("slipId", "marketId");

-- CreateIndex
CREATE UNIQUE INDEX "Bet_id_roundId_marketKind_key" ON "Bet"("id", "roundId", "marketKind");

-- AddForeignKey
ALTER TABLE "BetMarket" ADD CONSTRAINT "BetMarket_roundEncounterId_roundId_track_fkey" FOREIGN KEY ("roundEncounterId", "roundId", "track") REFERENCES "BetRoundEncounter"("id", "roundId", "track") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetSlip" ADD CONSTRAINT "BetSlip_roundId_eligibilityCharacterId_fkey" FOREIGN KEY ("roundId", "eligibilityCharacterId") REFERENCES "BetRoundBettor"("roundId", "characterId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_slipId_roundId_fkey" FOREIGN KEY ("slipId", "roundId") REFERENCES "BetSlip"("id", "roundId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_marketId_roundId_marketKind_fkey" FOREIGN KEY ("marketId", "roundId", "marketKind") REFERENCES "BetMarket"("id", "roundId", "kind") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_roundId_targetCharacterId_targetRole_fkey" FOREIGN KEY ("roundId", "targetCharacterId", "targetRole") REFERENCES "BetRoundCandidate"("roundId", "characterId", "role") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetWeeklySelection" ADD CONSTRAINT "BetWeeklySelection_betId_roundId_marketKind_fkey" FOREIGN KEY ("betId", "roundId", "marketKind") REFERENCES "Bet"("id", "roundId", "marketKind") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetWeeklySelection" ADD CONSTRAINT "BetWeeklySelection_roundEncounterId_roundId_inWeeklyProgre_fkey" FOREIGN KEY ("roundEncounterId", "roundId", "inWeeklyProgression") REFERENCES "BetRoundEncounter"("id", "roundId", "inWeeklyProgression") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Índices únicos parciais ─────────────────────────────────────────────────

-- No máximo um slip ATIVO por conta e rodada (D-34). Recusados e expirados não
-- entram no índice: ficam como histórico, e a conta pode abrir um novo slip.
CREATE UNIQUE INDEX "BetSlip_um_ativo_por_conta" ON "BetSlip"("roundId", "ownerUserId")
  WHERE "status" IN ('rascunho', 'aguardando_deposito', 'valido');

-- Uma Weekly Progression por rodada. O unique (roundId, kind, roundEncounterId)
-- não pega este caso: na Weekly o encounter é NULL, e NULL não colide.
CREATE UNIQUE INDEX "BetMarket_uma_weekly_por_rodada" ON "BetMarket"("roundId")
  WHERE "kind" = 'weekly_progression';

-- ── CHECKs ──────────────────────────────────────────────────────────────────

-- Ready antes do cutoff, e Ready sempre com o officer que o executou (D-31).
ALTER TABLE "BetRound" ADD CONSTRAINT "BetRound_ready_antes_do_cutoff"
  CHECK ("readyAt" IS NULL OR "readyAt" < "cutoffAt");
ALTER TABLE "BetRound" ADD CONSTRAINT "BetRound_ready_com_officer"
  CHECK (
    ("readyAt" IS NULL) = ("readyByUserId" IS NULL)
    AND ("readyAt" IS NULL) = ("readyByBattletag" IS NULL)
  );

-- Weekly Progression não tem boss; todo outro mercado tem.
ALTER TABLE "BetMarket" ADD CONSTRAINT "BetMarket_weekly_sem_boss"
  CHECK (("kind" = 'weekly_progression') = ("roundEncounterId" IS NULL));
-- Boss em progressão só tem First Death (R-22 × R-24).
ALTER TABLE "BetMarket" ADD CONSTRAINT "BetMarket_progressao_so_first_death"
  CHECK ("track" IS DISTINCT FROM 'progressao' OR "kind" = 'first_death');

-- Campos obrigatórios por estado do slip (§16.4).
ALTER TABLE "BetSlip" ADD CONSTRAINT "BetSlip_submetido_completo"
  CHECK (
    "status" NOT IN ('aguardando_deposito', 'valido', 'recusado')
    OR ("submittedAt" IS NOT NULL AND "expectedTotal" IS NOT NULL AND "depositCharacterId" IS NOT NULL)
  );
ALTER TABLE "BetSlip" ADD CONSTRAINT "BetSlip_valido_com_officer"
  CHECK (
    "status" <> 'valido'
    OR ("validatedAt" IS NOT NULL AND "validatedByUserId" IS NOT NULL AND "validatedByBattletag" IS NOT NULL)
  );
ALTER TABLE "BetSlip" ADD CONSTRAINT "BetSlip_recusado_com_officer_e_motivo"
  CHECK (
    "status" <> 'recusado'
    OR ("rejectedAt" IS NOT NULL AND "rejectedByUserId" IS NOT NULL
        AND "rejectedByBattletag" IS NOT NULL AND "rejectionReason" IS NOT NULL)
  );
ALTER TABLE "BetSlip" ADD CONSTRAINT "BetSlip_expirado_com_data"
  CHECK ("status" <> 'expirado' OR "expiredAt" IS NOT NULL);
ALTER TABLE "BetSlip" ADD CONSTRAINT "BetSlip_total_positivo"
  CHECK ("expectedTotal" IS NULL OR "expectedTotal" > 0);

-- Um stake por aposta, de 200 a 1.000 gold (R-16). Inteiro pelo tipo da coluna.
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_stake_200_a_1000"
  CHECK ("stake" BETWEEN 200 AND 1000);
-- Escolha simples tem exatamente um alvo; Weekly não tem alvo (D-28).
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_alvo_conforme_tipo"
  CHECK (("marketKind" = 'weekly_progression') = ("targetCharacterId" IS NULL));
-- Alvo e role andam juntos — sem isso a FK composta com o candidato seria
-- pulada (MATCH SIMPLE ignora a FK quando uma coluna é NULL).
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_alvo_com_role"
  CHECK (("targetCharacterId" IS NULL) = ("targetRole" IS NULL));
-- Role do alvo compatível com o tipo do mercado (D-04).
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_role_conforme_tipo"
  CHECK (
    ("marketKind" NOT IN ('top_dps', 'top_dps_parse') OR "targetRole" IN ('Melee', 'Ranged'))
    AND ("marketKind" NOT IN ('top_hps', 'top_hps_parse') OR "targetRole" = 'Heal')
  );

-- A seleção só existe em aposta de Weekly e em boss marcado para ela; com as
-- FKs compostas, isso vale para a linha de verdade, não para o que foi gravado.
ALTER TABLE "BetWeeklySelection" ADD CONSTRAINT "BetWeeklySelection_so_weekly"
  CHECK ("marketKind" = 'weekly_progression');
ALTER TABLE "BetWeeklySelection" ADD CONSTRAINT "BetWeeklySelection_so_boss_marcado"
  CHECK ("inWeeklyProgression");
