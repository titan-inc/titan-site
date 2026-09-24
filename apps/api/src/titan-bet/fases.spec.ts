import {
  auditoriaAberta,
  faseDaRodada,
  podeAuditar,
  podeDarReady,
  type EstadoDaRodada,
} from './fases';

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

const FUSO = 'America/Sao_Paulo';

describe('podeAuditar (D-30, D-73, §16.2) — depois de quinta 23:30, antes de confirmar', () => {
  // D-73: sexta 00:00 BRT. Antes da revisão 14 este instante era quinta 20:00
  // BRT, que a D-73 passou a recusar (§42.3 do test-design).
  const depois = new Date('2026-10-02T03:00:00Z');

  it('BETTING_CLOSED, AUDITING e CALCULATED: sim — refazer é outra tentativa', () => {
    expect(podeAuditar({ ...aberta, auditoria: null }, depois, FUSO)).toBe(true);
    expect(podeAuditar({ ...aberta, auditoria: 'aguardando_revisao' }, depois, FUSO)).toBe(true);
    expect(podeAuditar({ ...aberta, auditoria: 'pronta' }, depois, FUSO)).toBe(true);
    expect(podeAuditar({ ...aberta, auditoria: 'calculada' }, depois, FUSO)).toBe(true);
  });

  it('antes do cutoff, sem Ready, confirmada ou fechada: não', () => {
    expect(podeAuditar(aberta, new Date('2026-09-29T14:59:59Z'), FUSO)).toBe(false);
    expect(podeAuditar(emPreparacao, depois, FUSO)).toBe(false);
    expect(podeAuditar({ ...aberta, auditoria: 'confirmada' }, depois, FUSO)).toBe(false);
    expect(
      podeAuditar({ ...aberta, auditoria: 'confirmada', temClosingReport: true }, depois, FUSO),
    ).toBe(false);
  });
});

/**
 * D-73: a rodada só entra em auditoria depois de quinta 23:30 no fuso da
 * guilda. Cutoff terça 29/09 12:00 BRT → quinta 01/10 23:30 BRT = 02/10 02:30 UTC.
 */
describe('auditoriaAberta (D-73)', () => {
  const brt = (data: string, hora: string) => new Date(`${data}T${hora}:00-03:00`);
  const casos: Array<[string, Date, boolean]> = [
    ['terça 11:59, antes do cutoff', brt('2026-09-29', '11:59'), false],
    ['terça depois do cutoff', brt('2026-09-29', '12:01'), false],
    ['terça à noite, depois da raid', brt('2026-09-29', '23:59'), false],
    ['quarta', brt('2026-09-30', '15:00'), false],
    ['quinta 23:29', brt('2026-10-01', '23:29'), false],
    ['quinta 23:29:59.999', new Date(brt('2026-10-01', '23:30').getTime() - 1), false],
    ['quinta 23:30', brt('2026-10-01', '23:30'), true],
    ['sexta 01:00, depois de 23:30', brt('2026-10-02', '01:00'), true],
    ['semana seguinte', brt('2026-10-06', '10:00'), true],
  ];

  it.each(casos)('%s → %s', (_nome, agora, esperado) => {
    expect(auditoriaAberta(CUTOFF, agora, FUSO)).toBe(esperado);
  });

  it('podeAuditar recusa BETTING_CLOSED antes de quinta 23:30', () => {
    expect(podeAuditar(aberta, brt('2026-10-01', '23:29'), FUSO)).toBe(false);
    expect(podeAuditar(aberta, brt('2026-10-01', '23:30'), FUSO)).toBe(true);
  });

  describe('não depende do fuso da máquina', () => {
    const original = process.env.TZ;
    afterEach(() => {
      process.env.TZ = original;
    });

    it.each(['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati'])('TZ=%s', (tz) => {
      process.env.TZ = tz;
      expect(auditoriaAberta(CUTOFF, brt('2026-10-01', '23:29'), FUSO)).toBe(false);
      expect(auditoriaAberta(CUTOFF, brt('2026-10-01', '23:30'), FUSO)).toBe(true);
    });
  });

  it('o fuso é o configurado: em UTC, a quinta 23:30 é outra', () => {
    // Quinta 01/10 23:30 UTC = 20:30 BRT: aberta em UTC, ainda não em BRT.
    const quinta2330Utc = new Date('2026-10-01T23:30:00Z');
    expect(auditoriaAberta(CUTOFF, quinta2330Utc, 'UTC')).toBe(true);
    expect(auditoriaAberta(CUTOFF, quinta2330Utc, FUSO)).toBe(false);
  });
});
