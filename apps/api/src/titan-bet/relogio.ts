/**
 * O instante contra o qual a janela da auditoria é conferida (D-73). Em
 * produção é o relógio do sistema — nenhum módulo registra outro; os testes
 * passam um instante explícito pelo construtor, porque a janela abre dias
 * depois do cutoff e ninguém espera por ela. O banco não usa isto: as triggers
 * continuam no `now()` delas.
 */
export type Relogio = () => Date;

export const RELOGIO = Symbol('titan-bet:relogio');

export const relogioDoSistema: Relogio = () => new Date();
