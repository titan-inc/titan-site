-- A nota do loot master na entrega, e as duas razões que faltavam.
--
-- ## A nota
--
-- Opcional, e vale em QUALQUER entrega — não só no `pass item to`. "Foi pro
-- banco, ninguém quis" e "levou porque é BiS e nunca recebeu nada esta season"
-- são a mesma coisa do ponto de vista do registro: por que o conselho decidiu
-- assim.
--
-- Não é a nota do jogador (TIT-125), que fica na `LootSessionResponse`. As duas
-- podem existir na mesma peça e para a mesma pessoa; cada uma na sua tabela,
-- para não haver como confundir.
--
-- ## As razões
--
-- `banking` já estava semeado. Faltavam `disenchant` e `no_interest`, e as três
-- juntas são o `pass item to`: a peça vai para um player — alguém tem que
-- carregar o item no jogo —, mas o que fica registrado é a decisão do loot
-- master, não uma declaração de interesse.
--
-- `no_interest` é a saída da peça que ninguém pediu. Sem ela a sessão trava:
-- desde a TIT-67 entrega sem voto não sai sozinha, e peça sem dono segura o
-- encerramento.
--
-- `position` seguindo o `banking` (70), antes do `noop` (100), que é de sistema
-- e não aparece para ninguém escolher.

-- AlterTable
ALTER TABLE "LootSessionAward" ADD COLUMN "note" TEXT;

INSERT INTO "LootResponseOption" ("id", "slug", "label", "kind", "position", "updated_at")
VALUES
    ('seed_resp_disenchant',  'disenchant',  'Disenchant',  'loot_master', 80, CURRENT_TIMESTAMP),
    ('seed_resp_no_interest', 'no_interest', 'No interest', 'loot_master', 90, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
