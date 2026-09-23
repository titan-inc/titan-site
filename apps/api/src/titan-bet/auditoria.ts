/**
 * Auditar: de que report vem cada sessão da rodada (D-18, D-19, D-23, D-24,
 * D-25, D-26, D-30; spec §7.2). Sem banco e sem WCL — só a regra.
 */

export type Sessao = 'terca' | 'quinta';

/** Um report da guilda como o WCL lista: o que a auditoria congela (§15.10). */
export interface ReportDaGuilda {
  code: string;
  title: string;
  revision: number;
  /** Epoch ms. */
  startTime: number;
}

/** O que define as sessões de uma rodada. */
export interface JanelaDaRodada {
  cutoffAt: Date;
  /** Fuso da guilda (`GUILD_TIMEZONE`). */
  timezone: string;
}

/** Report oficial do Titan Bet: título começando por `titanbet`, sem diferenciar maiúsculas (D-18). */
export function ehReportTitanbet(title: string): boolean {
  return /^titanbet/i.test(title);
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * A sessão de um report, pelo **início** dele (D-26), no fuso da guilda.
 *
 * Terça é o dia do cutoff — o reset —, e só a partir dele: report iniciado na
 * terça de manhã, antes do reset, é da semana anterior. Quinta é dois dias
 * depois. Qualquer outro dia não existe para o Titan Bet (D-19, D-23).
 */
export function sessaoDoReport(startTime: number, janela: JanelaDaRodada): Sessao | null {
  const cutoff = janela.cutoffAt.getTime();
  const dia = dataLocal(startTime, janela.timezone);

  if (dia === dataLocal(cutoff, janela.timezone)) return startTime >= cutoff ? 'terca' : null;
  if (dia === dataLocal(cutoff + 2 * DIA_MS, janela.timezone)) return 'quinta';
  return null;
}

/**
 * A sessão de uma fight é a do report em que ela está, nunca a data dela
 * (D-26): fight depois da meia-noite, no report de terça, é da terça.
 */
export function sessaoDaFight(
  report: { startTime: number },
  _offsetNoReport: number,
  janela: JanelaDaRodada,
): Sessao | null {
  return sessaoDoReport(report.startTime, janela);
}

/** Os `titanbet*` de cada sessão; o resto é descartado (D-18, D-19). */
export function classificarReports(
  reports: ReportDaGuilda[],
  janela: JanelaDaRodada,
): Record<Sessao, ReportDaGuilda[]> {
  const porSessao: Record<Sessao, ReportDaGuilda[]> = { terca: [], quinta: [] };
  for (const r of reports) {
    if (!ehReportTitanbet(r.title)) continue;
    const sessao = sessaoDoReport(r.startTime, janela);
    if (sessao) porSessao[sessao].push(r);
  }
  return porSessao;
}

export type ResolucaoAutomatica =
  | { resolution: 'automatica'; report: ReportDaGuilda }
  | { resolution: 'ausente' | 'ambigua'; report: null };

/**
 * Inequívoco usa sozinho; ausente e ambíguo param e pedem o officer (D-24,
 * D-25, D-30). Ausente não é "sem raid", nem zero kills, nem `{}`.
 */
export function resolverSessao(candidatos: ReportDaGuilda[]): ResolucaoAutomatica {
  const [unico, ...outros] = candidatos;
  if (!unico) return { resolution: 'ausente', report: null };
  if (outros.length > 0) return { resolution: 'ambigua', report: null };
  return { resolution: 'automatica', report: unico };
}

/** `YYYY-MM-DD` de um instante no fuso dado. */
function dataLocal(epoch: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epoch));
}
