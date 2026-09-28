import { describe, expect, it } from 'vitest';
import { betSlipStatusSchema, meuSlipSchema, slipDoOfficerSchema } from './betting.js';
import {
  cancelarRodadaSchema,
  faseDaRodadaSchema,
  rodadasDoOfficerSchema,
  slipsSubmetidosSchema,
} from './rodada.js';

/** T-X02 — D-77: os contratos do cancelamento administrativo de rodada. */

describe('fase e estado do slip (D-77)', () => {
  it('a rodada tem a fase CANCELLED', () => {
    expect(faseDaRodadaSchema.parse('CANCELLED')).toBe('CANCELLED');
  });

  it('o slip tem o estado próprio `cancelado` — não é recusado nem expirado', () => {
    expect(betSlipStatusSchema.parse('cancelado')).toBe('cancelado');
  });
});

describe('cancelarRodadaSchema (D-77)', () => {
  it('exige motivo', () => {
    expect(cancelarRodadaSchema.parse({ motivo: 'raid cancelada pela liderança' })).toEqual({
      motivo: 'raid cancelada pela liderança',
    });
    expect(cancelarRodadaSchema.safeParse({ motivo: '   ' }).success).toBe(false);
    expect(cancelarRodadaSchema.safeParse({}).success).toBe(false);
  });

  it('é estrito: só o motivo', () => {
    expect(cancelarRodadaSchema.safeParse({ motivo: 'x', roundId: 'r1' }).success).toBe(false);
  });
});

describe('rodadas do officer com o cancelamento (D-77)', () => {
  const rodada = {
    roundId: 'r1',
    period: 1050,
    opensAt: '2026-09-25T03:00:00.000Z',
    cutoffAt: '2026-09-29T15:00:00.000Z',
    fase: 'CANCELLED',
    readyAt: '2026-09-26T15:00:00.000Z',
    readyByBattletag: 'Officer#0001',
    podeAuditar: false,
    auditavelDesde: '2026-10-02T02:30:00.000Z',
    podeCancelar: false,
    cancelamento: {
      motivo: 'raid cancelada',
      em: '2026-09-27T15:00:00.000Z',
      porBattletag: 'Officer#0001',
    },
  };

  it('quem cancelou, quando e por quê; e se ainda pode cancelar', () => {
    expect(rodadasDoOfficerSchema.parse({ rodadas: [rodada] })).toEqual({ rodadas: [rodada] });
    const aberta = { ...rodada, fase: 'OPEN', podeCancelar: true, cancelamento: null };
    expect(rodadasDoOfficerSchema.parse({ rodadas: [aberta] })).toEqual({ rodadas: [aberta] });
  });

  it('podeCancelar vem pronto da API — o painel não decide', () => {
    const { podeCancelar: _p, ...sem } = rodada;
    expect(rodadasDoOfficerSchema.safeParse({ rodadas: [sem] }).success).toBe(false);
  });
});

describe('slips da rodada cancelada no Officer Panel (D-77)', () => {
  const base = {
    slipId: 's1',
    ownerBattletag: 'Membro#1234',
    depositCharacter: { name: 'Depositante', realm: 'Azralon' },
    expectedTotal: 500,
    submittedAt: '2026-09-27T15:00:00.000Z',
  };

  it('cancelado com depósito confirmado — o que os officers devolvem fora do Titan Bet', () => {
    const s = { ...base, status: 'cancelado', depositoConfirmado: true };
    expect(slipsSubmetidosSchema.parse({ slips: [s] })).toEqual({ slips: [s] });
  });

  it('cancelado que nunca foi submetido vem sem data, total e depositante', () => {
    const s = {
      ...base,
      status: 'cancelado',
      depositCharacter: null,
      expectedTotal: null,
      submittedAt: null,
      depositoConfirmado: false,
    };
    expect(slipsSubmetidosSchema.parse({ slips: [s] })).toEqual({ slips: [s] });
  });

  it('depositoConfirmado é obrigatório', () => {
    expect(
      slipsSubmetidosSchema.safeParse({ slips: [{ ...base, status: 'valido' }] }).success,
    ).toBe(false);
  });

  it('"ver slip" de um slip cancelado', () => {
    const visto = {
      ...base,
      slipId: 's1',
      roundId: 'r1',
      status: 'cancelado',
      eligibilityCharacter: { name: 'Elegivel', realm: 'Azralon' },
      apostas: [],
      validatedByBattletag: 'Officer#0001',
      validatedAt: '2026-09-27T16:00:00.000Z',
      rejectedByBattletag: null,
      rejectedAt: null,
      rejectionReason: null,
      expiredAt: null,
    };
    expect(slipDoOfficerSchema.parse(visto)).toEqual(visto);
  });

  it('o slip do membro pode estar cancelado', () => {
    const meu = {
      slipId: 's1',
      status: 'cancelado',
      apostas: [],
      depositCharacter: null,
      expectedTotal: null,
      rejectionReason: null,
    };
    expect(meuSlipSchema.parse(meu)).toEqual(meu);
  });
});
