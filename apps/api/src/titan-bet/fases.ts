/**
 * Fases da rodada do Titan Bet (docs/specs/titan-bet.md §16.5).
 *
 * Só o Ready é gravado; o resto sai de dados que já existem — o relógio contra
 * o `cutoffAt`, a última auditoria não substituída e o closing report. Gravar
 * as fases como coluna criaria uma segunda verdade a manter sincronizada.
 */
export type FaseDaRodada =
  | 'PREPARATION'
  | 'NAO_ABERTA'
  | 'OPEN'
  | 'BETTING_CLOSED'
  | 'AUDITING'
  | 'CALCULATED'
  | 'SETTLED'
  | 'CLOSED';

/** Estado da última auditoria não substituída da rodada (§16.5). */
export type StatusDaAuditoria = 'aguardando_revisao' | 'pronta' | 'calculada' | 'confirmada';

export interface EstadoDaRodada {
  readyAt: Date | null;
  cutoffAt: Date;
  /** Nulo quando nenhum Auditar foi feito. */
  auditoria: StatusDaAuditoria | null;
  temClosingReport: boolean;
}

export function faseDaRodada(estado: EstadoDaRodada, agora: Date): FaseDaRodada {
  const antesDoCutoff = agora.getTime() < estado.cutoffAt.getTime();

  if (estado.readyAt === null) return antesDoCutoff ? 'PREPARATION' : 'NAO_ABERTA';
  if (antesDoCutoff) return 'OPEN';
  if (estado.temClosingReport) return 'CLOSED';

  switch (estado.auditoria) {
    case 'confirmada':
      return 'SETTLED';
    case 'calculada':
      return 'CALCULATED';
    case 'aguardando_revisao':
    case 'pronta':
      return 'AUDITING';
    case null:
      return 'BETTING_CLOSED';
  }
}

/** Ready não tem dia fixo: vale a qualquer momento da PREPARATION (D-31). */
export function podeDarReady(estado: EstadoDaRodada, agora: Date): boolean {
  return faseDaRodada(estado, agora) === 'PREPARATION';
}

/**
 * Auditar vale depois do cutoff de uma rodada que teve Ready, até a auditoria
 * ser confirmada (D-30, §16.2). Refazer antes disso é outra tentativa.
 */
export function podeAuditar(estado: EstadoDaRodada, agora: Date): boolean {
  const fase = faseDaRodada(estado, agora);
  return fase === 'BETTING_CLOSED' || fase === 'AUDITING' || fase === 'CALCULATED';
}
