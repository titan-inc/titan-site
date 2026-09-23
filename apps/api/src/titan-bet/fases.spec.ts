import { faseDaRodada, podeAuditar, podeDarReady, type EstadoDaRodada } from './fases';

/**
 * T-R08 e T-R12 — fases da rodada, derivadas (§16.5).
 *
 * Cutoff: terça 29/09/2026 12:00 BRT = 15:00 UTC.
 */
const CUTOFF = new Date('2026-09-29T15:00:00Z');

const emPreparacao: EstadoDaRodada = {
  readyAt: null,
  cutoffAt: CUTOFF,
  auditoria: null,
  temClosingReport: false,
};
const aberta: EstadoDaRodada = { ...emPreparacao, readyAt: new Date('2026-09-26T20:00:00Z') };

describe('faseDaRodada (T-R12)', () => {
  it('PREPARATION enquanto não houve Ready e o cutoff não passou', () => {
    expect(faseDaRodada(emPreparacao, new Date('2026-09-28T12:00:00Z'))).toBe('PREPARATION');
  });

  it('NAO_ABERTA quando o cutoff passa sem Ready', () => {
    expect(faseDaRodada(emPreparacao, CUTOFF)).toBe('NAO_ABERTA');
  });

  it('OPEN depois do Ready e antes do cutoff', () => {
    expect(faseDaRodada(aberta, new Date('2026-09-29T14:59:59Z'))).toBe('OPEN');
  });

  it('BETTING_CLOSED no cutoff, sem auditoria', () => {
    expect(faseDaRodada(aberta, CUTOFF)).toBe('BETTING_CLOSED');
  });

  it('AUDITING com auditoria aguardando revisão ou pronta', () => {
    const depois = new Date('2026-10-02T12:00:00Z');
    expect(faseDaRodada({ ...aberta, auditoria: 'aguardando_revisao' }, depois)).toBe('AUDITING');
    expect(faseDaRodada({ ...aberta, auditoria: 'pronta' }, depois)).toBe('AUDITING');
  });

  it('CALCULATED com a auditoria calculada', () => {
    expect(
      faseDaRodada({ ...aberta, auditoria: 'calculada' }, new Date('2026-10-02T12:00:00Z')),
    ).toBe('CALCULATED');
  });

  it('SETTLED com a auditoria confirmada', () => {
    expect(
      faseDaRodada({ ...aberta, auditoria: 'confirmada' }, new Date('2026-10-02T12:00:00Z')),
    ).toBe('SETTLED');
  });

  it('CLOSED com o closing report publicado', () => {
    expect(
      faseDaRodada(
        { ...aberta, auditoria: 'confirmada', temClosingReport: true },
        new Date('2026-10-03T12:00:00Z'),
      ),
    ).toBe('CLOSED');
  });
});

describe('podeDarReady (T-R08) — sem dia fixo, só antes do cutoff', () => {
  it.each([
    ['sexta', '2026-09-25T23:00:00Z'],
    ['sábado', '2026-09-26T15:00:00Z'],
    ['domingo', '2026-09-27T15:00:00Z'],
    ['segunda', '2026-09-28T23:59:59Z'],
    ['terça 11:59:59 BRT', '2026-09-29T14:59:59Z'],
  ])('%s: pode', (_dia, instante) => {
    expect(podeDarReady(emPreparacao, new Date(instante))).toBe(true);
  });

  it('terça 12:00:00 BRT: não pode', () => {
    expect(podeDarReady(emPreparacao, CUTOFF)).toBe(false);
  });

  it('rodada que já teve Ready: não pode de novo', () => {
    expect(podeDarReady(aberta, new Date('2026-09-28T12:00:00Z'))).toBe(false);
  });
});

describe('podeAuditar (D-30, §16.2) — depois do cutoff, antes de confirmar', () => {
  const depois = new Date('2026-10-01T23:00:00Z');

  it('BETTING_CLOSED, AUDITING e CALCULATED: sim — refazer é outra tentativa', () => {
    expect(podeAuditar({ ...aberta, auditoria: null }, depois)).toBe(true);
    expect(podeAuditar({ ...aberta, auditoria: 'aguardando_revisao' }, depois)).toBe(true);
    expect(podeAuditar({ ...aberta, auditoria: 'pronta' }, depois)).toBe(true);
    expect(podeAuditar({ ...aberta, auditoria: 'calculada' }, depois)).toBe(true);
  });

  it('antes do cutoff, sem Ready, confirmada ou fechada: não', () => {
    expect(podeAuditar(aberta, new Date('2026-09-29T14:59:59Z'))).toBe(false);
    expect(podeAuditar(emPreparacao, depois)).toBe(false);
    expect(podeAuditar({ ...aberta, auditoria: 'confirmada' }, depois)).toBe(false);
    expect(
      podeAuditar({ ...aberta, auditoria: 'confirmada', temClosingReport: true }, depois),
    ).toBe(false);
  });
});
