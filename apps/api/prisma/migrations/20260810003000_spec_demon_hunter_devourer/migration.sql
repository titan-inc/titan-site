-- Devourer, terceira spec do Demon Hunter, nascida nesta expansão.
--
-- Levantado do cliente do WoW em 09/08/2026: ele conhece 40 specs e este enum
-- tinha 39. O id do jogo é 1480.
--
-- `BEFORE` mantém a ordem do tipo no banco igual à da declaração no schema.
ALTER TYPE "WowSpec" ADD VALUE 'demon_hunter_devourer' BEFORE 'demon_hunter_havoc';
