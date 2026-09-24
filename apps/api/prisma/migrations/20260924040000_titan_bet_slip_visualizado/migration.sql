-- Titan Bet, revisão 11 (D-57): "ver slip" do Officer Panel. Cada acesso ao
-- slip como foi submetido fica registrado em BetEvent, com o officer e a hora.
ALTER TYPE "BetEventType" ADD VALUE 'slip_visualizado';
