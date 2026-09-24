/**
 * Fases da rodada do Titan Bet (docs/specs/titan-bet.md §16.5).
 *
 * Só o Ready é gravado; o resto sai de dados que já existem — o relógio contra
 * o `cutoffAt`, a última auditoria não substituída e o closing report. Gravar
 * as fases como coluna criaria uma segunda verdade a manter sincronizada.
 */
import type { FaseDaRodada } from '@titan/shared';
import { inicioDaAuditoria } from './calendario';

/** O contrato do shared (`faseDaRodadaSchema`) — o front lê as mesmas fases. */
export type { FaseDaRodada };

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
 * A rodada já pode entrar em auditoria? Só a partir de quinta 23:30 no fuso da
 * guilda (D-73). É **a** comparação: Auditar, "sem raid", Calcular e Confirmar
 * passam por aqui, e o Officer Panel recebe o resultado pronto.
 */
export function auditoriaAberta(cutoffAt: Date, agora: Date, timezone: string): boolean {
  return agora.getTime() >= inicioDaAuditoria(cutoffAt, timezone).getTime();
}

/**
 * O porquê de a janela ainda estar fechada, para quem chamou antes da hora
 * (D-73); `null` se já abriu.
 */
export function motivoDaJanelaFechada(
  cutoffAt: Date,
  agora: Date,
  timezone: string,
): string | null {
  if (auditoriaAberta(cutoffAt, agora, timezone)) return null;
  const quando = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(inicioDaAuditoria(cutoffAt, timezone));
  return `a auditoria só abre depois da raid de quinta, às 23:30 (${quando}, ${timezone})`;
}

/**
 * Auditar vale a partir de quinta 23:30 (D-73) numa rodada que teve Ready, até
 * a auditoria ser confirmada (D-30, §16.2). Refazer antes disso é outra
 * tentativa.
 */
export function podeAuditar(estado: EstadoDaRodada, agora: Date, timezone: string): boolean {
  const fase = faseDaRodada(estado, agora);
  return (
    (fase === 'BETTING_CLOSED' || fase === 'AUDITING' || fase === 'CALCULATED') &&
    auditoriaAberta(estado.cutoffAt, agora, timezone)
  );
}
