-- Titan Bet, revisão 15 (D-76): o Auditar congela os dados externos de cada
-- report oficial, e o Calcular lê só deles. Estrutura: a coluna. As invariantes
-- (obrigatória em referência nova, proveniência, imutável) vêm na migration
-- seguinte, depois do RED.
--
-- Aditiva e anulável: as referências gravadas antes desta revisão não têm
-- snapshot, e nenhum é fabricado para elas.
ALTER TABLE "BetAuditSourceReport" ADD COLUMN "snapshot" JSONB;
