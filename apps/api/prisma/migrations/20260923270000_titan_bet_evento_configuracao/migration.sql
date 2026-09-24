-- Titan Bet — preparação da semana (D-45): cada salvamento vira BetEvent (§16.8),
-- porque remover configuração apaga a linha e só o evento guarda o que existia.
ALTER TYPE "BetEventType" ADD VALUE 'rodada_criada';
ALTER TYPE "BetEventType" ADD VALUE 'configuracao_salva';
