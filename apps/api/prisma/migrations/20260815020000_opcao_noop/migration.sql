-- A opção `noop`: silêncio de quem estava na sessão.
--
-- Migration separada porque o valor `sistema` do enum nasceu na anterior, e o
-- Postgres não deixa usar valor de enum recém-criado na mesma transação.
--
-- `noop` NÃO é `pass`. `pass` é declaração — a pessoa olhou a peça e abriu mão.
-- `noop` é ausência de declaração — ela estava na raid e não disse nada.
-- Colapsar as duas faria o histórico afirmar uma escolha que ninguém fez, que é
-- o erro que a Regra 7 evita quando manda gravar o fato observável e nunca a
-- inferência. E é a distinção que dá sentido ao que a sessão ao vivo acrescenta
-- ao histórico: "pediu e não levou", "abriu mão" e "não se manifestou" são três
-- respostas diferentes para a mesma peça.
--
-- `position` alto porque ela não é escolha de ninguém: não aparece na lista de
-- botões do jogador, e o `kind = sistema` é o que decide isso.

INSERT INTO "LootResponseOption" ("id", "slug", "label", "kind", "position", "updated_at")
VALUES ('seed_resp_noop', 'noop', 'Não respondeu', 'sistema', 100, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
