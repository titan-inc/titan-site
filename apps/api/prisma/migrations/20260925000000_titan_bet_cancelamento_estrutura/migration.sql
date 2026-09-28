-- Titan Bet, revisão 16 (D-77): cancelamento administrativo de rodada.
-- Estrutura: o estado próprio do slip, o evento e os campos do cancelamento na
-- rodada. As invariantes (quem pode cancelar, o estado terminal, o bloqueio das
-- mutações) vêm na migration seguinte, depois do RED.
--
-- Aditiva: valores novos nos enums e colunas anuláveis — nada é reescrito.
ALTER TYPE "BetSlipStatus" ADD VALUE 'cancelado';
ALTER TYPE "BetEventType" ADD VALUE 'rodada_cancelada';

ALTER TABLE "BetRound"
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledByUserId" TEXT,
  ADD COLUMN "cancelledByBattletag" TEXT,
  ADD COLUMN "cancellationReason" TEXT;
