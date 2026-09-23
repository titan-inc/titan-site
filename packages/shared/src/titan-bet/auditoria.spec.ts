import { describe, expect, it } from 'vitest';
import { auditoriaCorrenteSchema, escolherFonteSchema } from './auditoria.js';

/**
 * Contrato do Auditar no Officer Panel (D-25, D-30; spec §7.2).
 * O officer vê as fontes e os candidatos, e escolhe entre eles.
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
      resolution: 'ambigua',
      report: null,
      candidatos: [report, { ...report, code: 'XyZ789' }],
      resolvedByBattletag: null,
      resolvedAt: null,
    },
    {
      session: 'quinta',
      resolution: 'automatica',
      report,
      candidatos: [report],
      resolvedByBattletag: null,
      resolvedAt: null,
    },
  ],
};

describe('auditoriaCorrenteSchema', () => {
  it('aceita a tentativa com as duas fontes e os candidatos', () => {
    expect(auditoriaCorrenteSchema.parse(auditoria)).toEqual(auditoria);
  });

  it('só as sessões e resoluções da D-19/D-30', () => {
    const quarta = { ...auditoria.fontes[0], session: 'quarta' };
    expect(auditoriaCorrenteSchema.safeParse({ ...auditoria, fontes: [quarta] }).success).toBe(
      false,
    );
    const inventada = { ...auditoria.fontes[0], resolution: 'sem_raid' };
    expect(auditoriaCorrenteSchema.safeParse({ ...auditoria, fontes: [inventada] }).success).toBe(
      false,
    );
  });

  it('a tentativa corrente nunca é `substituida`', () => {
    expect(auditoriaCorrenteSchema.safeParse({ ...auditoria, status: 'substituida' }).success).toBe(
      false,
    );
  });
});

describe('escolherFonteSchema', () => {
  it('o código do report escolhido, obrigatório', () => {
    expect(escolherFonteSchema.safeParse({ reportCode: 'AbC123' }).success).toBe(true);
    expect(escolherFonteSchema.safeParse({ reportCode: '' }).success).toBe(false);
    expect(escolherFonteSchema.safeParse({}).success).toBe(false);
  });
});
