-- Titan Bet — Weekly Progression por boss (D-54, mudança de produto) e o desfecho
-- sem_vencedor (D-61). Estrutura: sai o conjunto exato (BetWeeklySelection e a
-- marcação inWeeklyProgression); a aposta da Weekly ganha o boss como alvo.

-- AlterEnum
ALTER TYPE "BetResultOutcome" ADD VALUE 'sem_vencedor';

-- DropForeignKey
ALTER TABLE "BetWeeklySelection" DROP CONSTRAINT "BetWeeklySelection_roundId_fkey";

-- DropForeignKey
ALTER TABLE "BetWeeklySelection" DROP CONSTRAINT "BetWeeklySelection_betId_roundId_marketKind_fkey";

-- DropForeignKey
ALTER TABLE "BetWeeklySelection" DROP CONSTRAINT "BetWeeklySelection_roundEncounterId_roundId_inWeeklyProgre_fkey";

-- DropIndex
DROP INDEX "BetRoundEncounter_id_roundId_inWeeklyProgression_key";

-- AlterTable
ALTER TABLE "BetRoundEncounter" DROP COLUMN "inWeeklyProgression";

-- AlterTable
ALTER TABLE "Bet" ADD COLUMN     "targetEncounterId" TEXT,
ADD COLUMN     "targetEncounterTrack" "BetEncounterTrack";

-- DropTable
DROP TABLE "BetWeeklySelection";


-- O trigger de editabilidade tinha um ramo só para BetWeeklySelection; com a
-- tabela fora, fica só o da Bet. Mesma regra (slip em rascunho, antes do cutoff).
CREATE OR REPLACE FUNCTION titanbet_aposta_editavel() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_slips TEXT[] := ARRAY[]::TEXT[];
  v_slip  TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_slips := v_slips || OLD."slipId"; END IF;
  IF TG_OP <> 'DELETE' THEN v_slips := v_slips || NEW."slipId"; END IF;

  FOREACH v_slip IN ARRAY v_slips LOOP
    IF titanbet_slip_editavel(v_slip) IS FALSE THEN
      RAISE EXCEPTION 'titanbet: % — o slip % não está mais em rascunho antes do cutoff', TG_TABLE_NAME, v_slip;
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
