import {
  classificarReports,
  ehReportTitanbet,
  resolverSessao,
  sessaoDaFight,
  sessaoDoReport,
  type ReportDaGuilda,
} from './auditoria';

/**
 * Auditar — a parte que não precisa de banco nem de WCL (D-18, D-19, D-23,
 * D-24, D-25, D-26; spec §7.2). titan-bet-test-design.md §3.7.
 */

const FUSO = 'America/Sao_Paulo';
/** Terça, 29/09/2026, 12:00 BRT — o reset US. */
const CUTOFF = new Date('2026-09-29T15:00:00Z');
const RODADA = { cutoffAt: CUTOFF, timezone: FUSO };

/** Um instante no horário de Brasília (UTC−3, sem horário de verão). */
const brt = (data: string, hora: string) => new Date(`${data}T${hora}:00-03:00`).getTime();

const report = (over: Partial<ReportDaGuilda> = {}): ReportDaGuilda => ({
  code: 'AbC123',
  title: 'titanbet',
  revision: 1,
  startTime: brt('2026-09-29', '21:00'),
  ...over,
});

describe('T-A01 — prefixo `titanbet`, sem diferenciar maiúsculas (D-18)', () => {
  it.each(['titanbet', 'TitanBet Tuesday', 'TITANBET raid', 'titanbet-09-23'])('%s → sim', (t) => {
    expect(ehReportTitanbet(t)).toBe(true);
  });

  it.each(['Titan bet', 'xtitanbet', 'bet titanbet', 'Titan Inc Mythic', ''])('%s → não', (t) => {
    expect(ehReportTitanbet(t)).toBe(false);
  });
});

describe('T-A02 — só terça e quinta do reset (D-19, D-23)', () => {
  it('terça 21:00 BRT é terça, mesmo já sendo quarta em UTC', () => {
    expect(sessaoDoReport(brt('2026-09-29', '21:00'), RODADA)).toBe('terca');
  });

  it('quinta 20:30 BRT é quinta', () => {
    expect(sessaoDoReport(brt('2026-10-01', '20:30'), RODADA)).toBe('quinta');
  });

  it.each([
    ['quarta', brt('2026-09-30', '21:00')],
    ['sexta', brt('2026-10-02', '21:00')],
    ['domingo', brt('2026-10-04', '21:00')],
    ['a terça da semana seguinte', brt('2026-10-06', '21:00')],
    ['a quinta da semana anterior', brt('2026-09-24', '21:00')],
  ])('report iniciado n%s → nenhuma sessão', (_dia, inicio) => {
    expect(sessaoDoReport(inicio, RODADA)).toBeNull();
  });

  it('terça antes do cutoff é da semana anterior ao reset → nenhuma sessão', () => {
    expect(sessaoDoReport(brt('2026-09-29', '10:00'), RODADA)).toBeNull();
  });
});

describe('T-A03 — o report é o boundary da sessão (D-26)', () => {
  it('fight às 00:40 de quarta, num report que começou na terça, é da terça', () => {
    const inicio = brt('2026-09-29', '21:00');
    const offset = brt('2026-09-30', '00:40') - inicio;
    expect(sessaoDaFight({ startTime: inicio }, offset, RODADA)).toBe('terca');
  });

  it('e fight de um report de quarta não vira quinta por passar da meia-noite', () => {
    const inicio = brt('2026-09-30', '22:00');
    const offset = brt('2026-10-01', '01:00') - inicio;
    expect(sessaoDaFight({ startTime: inicio }, offset, RODADA)).toBeNull();
  });
});

describe('classificarReports — só `titanbet*` de terça e quinta, por sessão', () => {
  it('ignora report comum e `titanbet` de outro dia', () => {
    const terca = report({ code: 'T1' });
    const quinta = report({ code: 'Q1', startTime: brt('2026-10-01', '20:30') });
    const comum = report({ code: 'X1', title: 'Titan Inc Mythic' });
    const quarta = report({ code: 'W1', startTime: brt('2026-09-30', '21:00') });

    expect(classificarReports([terca, comum, quarta, quinta], RODADA)).toEqual({
      terca: [terca],
      quinta: [quinta],
    });
  });

  it('sessão sem nada fica com lista vazia, não some', () => {
    expect(classificarReports([], RODADA)).toEqual({ terca: [], quinta: [] });
  });
});

// Mudança de produto (D-63): vários `titanbet*` na sessão não são mais ambiguidade
// para o officer resolver — todos são fonte. Substitui "dois ou mais → ambígua".
describe('resolverSessao — todos os `titanbet*` da sessão são fonte (D-24, D-63)', () => {
  it('um report → automática, com ele', () => {
    const r = report();
    expect(resolverSessao([r])).toEqual({ resolution: 'automatica', reports: [r] });
  });

  it('nenhum → ausente: não é "sem raid", não é `{}` — pede o officer (D-60)', () => {
    expect(resolverSessao([])).toEqual({ resolution: 'ausente', reports: [] });
  });

  it('T-A16: dois ou mais → automática com todos, em ordem de início', () => {
    const b = report({ code: 'B', startTime: brt('2026-09-29', '22:00') });
    const a = report({ code: 'A', startTime: brt('2026-09-29', '21:00') });
    expect(resolverSessao([b, a])).toEqual({ resolution: 'automatica', reports: [a, b] });
  });
});
