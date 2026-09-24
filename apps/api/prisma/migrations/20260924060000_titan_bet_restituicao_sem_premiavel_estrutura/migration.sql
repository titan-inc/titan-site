-- Titan Bet, revisão 14 (D-74): rodada sem nenhum mercado premiável. O órfão
-- restitui o próprio P (90%) aos apostadores válidos daquele mercado, pelo
-- stake; G₀ e o indivisível ficam com o Guild Bank. Tipo próprio no ledger —
-- não é o `restituicao_anulado` do VOID (100%, sem receita) nem a D-67.
--
-- Aditivo: só o valor novo. As invariantes dele vêm na migration seguinte,
-- porque o Postgres não usa um valor de enum na mesma transação que o criou.
ALTER TYPE "GoldLedgerKind" ADD VALUE 'restituicao_sem_premiavel';
