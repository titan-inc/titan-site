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
        motivo: null,
        validPool: 1000,
        prizePool: 900,
        winningStake: 600,
        vencedores: [{ characterId: 'c1', name: 'Fulano', realm: 'Azralon' }],
        bossesVencedores: [],
        evidencia: { versao: 1 },
      },
      {
        marketId: 'm2',
        kind: 'first_death',
        outcome: 'sem_vencedor',
        motivo: 'sem_kill',
        validPool: 300,
        prizePool: null,
        winningStake: null,
        vencedores: [],
        bossesVencedores: [],
        evidencia: { versao: 1 },
      },
    ],
  };

  // Mudança de produto (D-61): mercado sem resultado premiável é `sem_vencedor`,
  // não proposta de VOID; o motivo vale para os dois desfechos.
  it('aceita vencedores e sem vencedor, com o motivo e a evidência', () => {
    expect(resultadosDaAuditoriaSchema.parse(vista)).toEqual(vista);
  });

  it('é estrito: não carrega aposta, slip nem conta', () => {
    const comAposta = { ...vista.mercados[0], apostas: [] };
    expect(resultadosDaAuditoriaSchema.safeParse({ ...vista, mercados: [comAposta] }).success).toBe(
      false,
    );
  });
});
