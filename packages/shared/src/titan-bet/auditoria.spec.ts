import { describe, expect, it } from 'vitest';
import { auditoriaCorrenteSchema, declararSemRaidSchema } from './auditoria.js';

/**
 * Contrato do Auditar no Officer Panel (D-30, D-60, D-63; spec §7.2).
 *
 * Mudança de produto (D-63): a sessão não tem mais "report escolhido" nem
 * "candidatos" para o officer escolher — todos os `titanbet*` da sessão são
 * fonte. O que o officer faz é declarar "sem raid oficial" (D-60). Substitui o
 * contrato de `escolherFonteSchema`.
 */

const report = {
  code: 'AbC123',
  title: 'titanbet',
  revision: 3,
  startTime: '2026-09-23T00:00:00.000Z',
};

const auditoria = {
  auditId: 'a1',
  attempt: 2,
  status: 'aguardando_revisao',
  startedByBattletag: 'Officer#1',
  startedAt: '2026-09-25T02:00:00.000Z',
  fontes: [
    {
      session: 'terca',
      resolution: 'automatica',
      reports: [report, { ...report, code: 'XyZ789' }],
      motivoSemRaid: null,
      resolvedByBattletag: null,
      resolvedAt: null,
    },
    {
      session: 'quinta',
      resolution: 'ausente',
      reports: [],
      motivoSemRaid: null,
      resolvedByBattletag: null,
      resolvedAt: null,
    },
  ],
};

describe('auditoriaCorrenteSchema', () => {
  it('T-A16: a sessão com todos os reports usados; a ausente pedindo o officer', () => {
    expect(auditoriaCorrenteSchema.parse(auditoria)).toEqual(auditoria);
  });

  it('T-A19: sessão declarada sem raid, com motivo e officer', () => {
    const semRaid = {
      ...auditoria.fontes[1],
      resolution: 'sem_raid',
      motivoSemRaid: 'raid cancelada',
      resolvedByBattletag: 'Officer#2',
      resolvedAt: '2026-09-25T03:00:00.000Z',
    };
    expect(auditoriaCorrenteSchema.safeParse({ ...auditoria, fontes: [semRaid] }).success).toBe(
      true,
    );
  });

  it('as resoluções antigas não existem mais', () => {
    for (const resolution of ['ambigua', 'escolha_officer']) {
      const fonte = { ...auditoria.fontes[0], resolution };
      expect(auditoriaCorrenteSchema.safeParse({ ...auditoria, fontes: [fonte] }).success).toBe(
        false,
      );
    }
  });

  it('só as sessões da D-19', () => {
    const quarta = { ...auditoria.fontes[0], session: 'quarta' };
    expect(auditoriaCorrenteSchema.safeParse({ ...auditoria, fontes: [quarta] }).success).toBe(
      false,
    );
  });

  it('a tentativa corrente nunca é `substituida`', () => {
    expect(auditoriaCorrenteSchema.safeParse({ ...auditoria, status: 'substituida' }).success).toBe(
      false,
    );
  });
});

describe('declararSemRaidSchema — "não houve raid oficial nesta sessão" (D-60)', () => {
  it('o motivo é obrigatório', () => {
    expect(declararSemRaidSchema.safeParse({ motivo: 'raid cancelada' }).success).toBe(true);
    expect(declararSemRaidSchema.safeParse({ motivo: '  ' }).success).toBe(false);
    expect(declararSemRaidSchema.safeParse({}).success).toBe(false);
  });
});
