import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { oddsDaRodadaSchema } from './published.js';

/**
 * Contrato PUBLICADO do Titan Bet (spec §9.1, §16.10). T-O03: a resposta de
 * odds não carrega dado individual — só o multiplicador por opção.
 */

const odds = {
  roundId: 'r1',
  mercados: [
    {
      marketId: 'm1',
      opcoes: [
        { characterId: 'c1', multiplicador: 3 },
        { characterId: 'c2', multiplicador: null },
      ],
    },
  ],
};

describe('T-O03 — odds sem dado individual (D-36, §16.10)', () => {
  it('afirma os campos obrigatórios em cada nível, e só eles', () => {
    expect(Object.keys(oddsDaRodadaSchema.shape).sort()).toEqual(['mercados', 'roundId']);
    expect(oddsDaRodadaSchema.parse(odds)).toEqual(odds);
  });

  it.each(['userId', 'ownerUserId', 'slipId', 'stake', 'apostas', 'ownerBattletag'])(
    'recusa %s em qualquer nível — estrito, não descarta em silêncio',
    (campo) => {
      expect(oddsDaRodadaSchema.safeParse({ ...odds, [campo]: 'x' }).success).toBe(false);

      const mercado = { ...odds.mercados[0], [campo]: 'x' };
      expect(oddsDaRodadaSchema.safeParse({ ...odds, mercados: [mercado] }).success).toBe(false);

      const opcao = { characterId: 'c1', multiplicador: 3, [campo]: 'x' };
      expect(
        oddsDaRodadaSchema.safeParse({
          ...odds,
          mercados: [{ marketId: 'm1', opcoes: [opcao] }],
        }).success,
      ).toBe(false);
    },
  );

  it('opção sem aposta é "—": multiplicador nulo, nunca zero (R-35)', () => {
    const zero = { marketId: 'm1', opcoes: [{ characterId: 'c1', multiplicador: 0 }] };
    expect(oddsDaRodadaSchema.safeParse({ ...odds, mercados: [zero] }).success).toBe(false);
  });
});

/**
 * T-Z05 (§9.1) — **guarda de regressão**, sem RED (test-design §5.4): o
 * contrato publicado não importa o privado. Importar traria para cá os tipos do
 * slip, e o próximo schema publicado os usaria num `extend` conveniente.
 */
describe('T-Z05 — published não importa betting', () => {
  it('nenhum import de ./betting no módulo publicado', () => {
    const fonte = readFileSync(new URL('./published.ts', import.meta.url), 'utf8');
    const imports = [...fonte.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports).toEqual(['zod']);
  });
});
