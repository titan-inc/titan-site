import { describe, expect, it } from 'vitest';
import { resultadosDaAuditoriaSchema } from './resultado.js';

/** O que o Officer Panel revisa antes de confirmar (§7.3, D-16). Lado de officer. */
describe('resultadosDaAuditoriaSchema', () => {
  const vista = {
    auditId: 'a1',
    status: 'calculada',
    calculatedAt: '2026-09-25T02:00:00.000Z',
    mercados: [
      {
        marketId: 'm1',
        kind: 'top_dps',
        outcome: 'vencedores',
        voidReason: null,
        validPool: 1000,
        prizePool: 900,
        winningStake: 600,
        vencedores: [{ characterId: 'c1', name: 'Fulano', realm: 'Azralon' }],
        kills: [],
        evidencia: { versao: 1 },
      },
      {
        marketId: 'm2',
        kind: 'first_death',
        outcome: 'anulado',
        voidReason: 'sem_kill',
        validPool: 300,
        prizePool: null,
        winningStake: null,
        vencedores: [],
        kills: [],
        evidencia: { versao: 1 },
      },
    ],
  };

  it('aceita vencedores e proposta de VOID, com a evidência', () => {
    expect(resultadosDaAuditoriaSchema.parse(vista)).toEqual(vista);
  });

  it('é estrito: não carrega aposta, slip nem conta', () => {
    const comAposta = { ...vista.mercados[0], apostas: [] };
    expect(resultadosDaAuditoriaSchema.safeParse({ ...vista, mercados: [comAposta] }).success).toBe(
      false,
    );
  });
});
