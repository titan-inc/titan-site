-- A nota do jogador na resposta.
--
-- O conselho decide com a informação que tem. Uma opção de resposta é um
-- rótulo; o motivo por trás dela às vezes é o que muda a decisão — e hoje esse
-- motivo é dito por voz no Discord, some, e não fica no histórico.
--
-- Mesmo instinto da Regra 7 que já vale para presença: o sistema grava o fato,
-- o humano acrescenta o contexto, e o que fica no banco é o que o humano
-- escreveu.
--
-- É a SEGUNDA nota da sessão, e de propósito num campo diferente da
-- `LootSessionAward.note`: as duas podem existir na mesma peça e para a mesma
-- pessoa. Uma é a pessoa sobre si mesma ao pedir, a outra é o conselho sobre a
-- decisão.

ALTER TABLE "LootSessionResponse" ADD COLUMN "note" TEXT;
