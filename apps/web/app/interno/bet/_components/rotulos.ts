import type { BetSlipStatus, FaseDaRodada } from '@titan/shared';

/** Como cada coisa do Titan Bet aparece na tela. Só apresentação — nenhuma regra. */

type TipoDeMercado =
  | 'top_dps'
  | 'top_dps_parse'
  | 'top_hps'
  | 'top_hps_parse'
  | 'top_dispels'
  | 'first_death'
  | 'weekly_progression';

const NOME_DO_MERCADO: Record<TipoDeMercado, string> = {
  top_dps: 'Top DPS',
  top_dps_parse: 'Top DPS Parse %',
  top_hps: 'Top HPS',
  top_hps_parse: 'Top HPS Parse %',
  top_dispels: 'Top Dispels',
  first_death: 'First Death',
  weekly_progression: 'Weekly Progression',
};

/** "Top DPS · Boss" — a Weekly é da rodada e não tem boss (D-54). */
export function tituloDoMercado(kind: TipoDeMercado, encounterName: string | null): string {
  const nome = NOME_DO_MERCADO[kind];
  return encounterName ? `${nome} · ${encounterName}` : nome;
}

/** Multiplicador projetado; `null` é "—", opção sem aposta válida (§16.10). */
export function multiplicador(valor: number | null): string {
  if (valor === null) return '—';
  return `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

export function gold(valor: number): string {
  return `${valor.toLocaleString('pt-BR')} gold`;
}

/** Sempre nome + realm: personagens diferentes podem ter o mesmo nome (Regra 6). */
export function personagem(p: { name: string; realm: string }): string {
  return `${p.name}-${p.realm}`;
}

export const STATUS_DO_SLIP: Record<BetSlipStatus, string> = {
  rascunho: 'Rascunho',
  aguardando_deposito: 'Aguardando depósito',
  valido: 'Válido',
  recusado: 'Recusado',
  expirado: 'Expirado',
  cancelado: 'Cancelado',
};

export const FASE: Record<FaseDaRodada, string> = {
  PREPARATION: 'Em preparação',
  NAO_ABERTA: 'Não abriu',
  OPEN: 'Apostas abertas',
  BETTING_CLOSED: 'Apostas encerradas',
  AUDITING: 'Em auditoria',
  CALCULATED: 'Resultados calculados',
  SETTLED: 'Liquidada',
  CLOSED: 'Encerrada',
  CANCELLED: 'Cancelada',
};

/** Por que um mercado ficou sem vencedor, ou foi anulado (D-61). */
const MOTIVO: Record<string, string> = {
  sem_kill: 'o boss não morreu na semana',
  sem_pull: 'nenhuma pull válida do boss',
  sem_vencedor: 'nenhuma opção elegível venceu',
  mercado_cancelado: 'mercado cancelado',
};

export function motivo(codigo: string | null): string {
  if (codigo === null) return 'sem motivo registrado';
  return MOTIVO[codigo] ?? codigo;
}

/** Os lançamentos do ledger (§16.6), como o officer lê. */
export const TIPO_DE_LANCAMENTO: Record<
  | 'deposito_validado'
  | 'premio'
  | 'restituicao_anulado'
  | 'receita_guilda'
  | 'residuo_guilda'
  | 'restituicao_expirado'
  | 'ajuste'
  | 'pagamento'
  | 'restituicao_sem_premiavel',
  string
> = {
  deposito_validado: 'Depósito validado',
  premio: 'Prêmio',
  restituicao_anulado: 'Restituição (anulado)',
  receita_guilda: 'Receita da guilda',
  residuo_guilda: 'Resíduo da guilda',
  restituicao_expirado: 'Restituição (expirado, histórico)',
  ajuste: 'Ajuste',
  pagamento: 'Pagamento',
  restituicao_sem_premiavel: 'Restituição (rodada sem premiável)',
};
