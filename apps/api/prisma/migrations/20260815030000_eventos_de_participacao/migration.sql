-- Os dois eventos novos da trilha append-only da sessão.
--
-- `participante_entrou` cobre entrar e trocar de personagem: a linha da
-- participação é a mesma (upsert por pessoa), e é o log que guarda a troca.
--
-- `silencio_registrado` é UM evento para a transição inteira, com a contagem.
-- Um por linha seriam 125 eventos numa noite de 25 pessoas e 5 peças, todos
-- dizendo a mesma coisa — e o que a auditoria precisa saber é quando o silêncio
-- foi congelado, não item a item.

ALTER TYPE "LootSessionEventType" ADD VALUE 'participante_entrou';
ALTER TYPE "LootSessionEventType" ADD VALUE 'silencio_registrado';
