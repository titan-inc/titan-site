import type { OddsDaRodada } from '@titan/shared';
import { describe, expect, it } from 'vitest';
import { CARDAPIO, ODDS } from './fixtures';
import { oddsComValor } from './odds-com-valor';

/** D-80 — só as odds com aposta válida, por mercado, da que mais paga para a que menos paga. */

describe('oddsComValor', () => {
  it('T-O01: descarta opção sem aposta (null) e resolve os nomes, inclusive os bosses da Weekly', () => {
    const r = oddsComValor(CARDAPIO, ODDS);
    expect(r.map((m) => m.marketId)).toEqual(['m-dps', 'm-fd', 'm-weekly']);
    expect(r[0]!.opcoes).toEqual([
      { id: 'c-meu', nome: 'Meupersonagem', realm: 'Azralon', multiplicador: 2.5 },
    ]);
    expect(r[2]!.opcoes).toEqual([
      { id: 'e2', nome: 'Boss Novo', realm: null, multiplicador: 1.5 },
    ]);
    expect(r[0]!.titulo).toBe('Top DPS · Boss Farm');
    expect(r[2]!.titulo).toBe('Weekly Progression');
  });

  it('T-O02: ordena por multiplicador decrescente — o que mais paga primeiro', () => {
    const r = oddsComValor(CARDAPIO, ODDS);
    expect(r[1]!.opcoes.map((o) => [o.nome, o.multiplicador])).toEqual([
      ['Meupersonagem', 3],
      ['Outropersonagem', 1.8],
    ]);
  });

  it('T-O02: empate desempata por nome e depois por realm, crescentes', () => {
    const odds: OddsDaRodada = {
      roundId: 'r1',
      mercados: [
        {
          marketId: 'm-dps',
          opcoes: [
            { characterId: 'c-outro', multiplicador: 2 },
            { characterId: 'c-cura', multiplicador: 2 },
            { characterId: 'c-meu', multiplicador: 2 },
          ],
        },
      ],
    };
    expect(oddsComValor(CARDAPIO, odds)[0]!.opcoes.map((o) => o.nome)).toEqual([
      'Curandeiro',
      'Meupersonagem',
      'Outropersonagem',
    ]);
  });

  it('T-O03: mercado sem opção com valor some, e a ordem é a do cardápio', () => {
    const odds: OddsDaRodada = {
      roundId: 'r1',
      mercados: [
        { marketId: 'm-weekly', opcoes: [{ roundEncounterId: 'e3', multiplicador: 4 }] },
        { marketId: 'm-fd', opcoes: [{ characterId: 'c-meu', multiplicador: null }] },
        { marketId: 'm-dps', opcoes: [{ characterId: 'c-outro', multiplicador: 1.2 }] },
      ],
    };
    expect(oddsComValor(CARDAPIO, odds).map((m) => m.marketId)).toEqual(['m-dps', 'm-weekly']);
  });

  it('T-O04: opção que o cardápio não conhece é descartada', () => {
    const odds: OddsDaRodada = {
      roundId: 'r1',
      mercados: [
        {
          marketId: 'm-dps',
          opcoes: [
            { characterId: 'desconhecido', multiplicador: 9 },
            { characterId: 'c-meu', multiplicador: 2 },
          ],
        },
      ],
    };
    expect(oddsComValor(CARDAPIO, odds)[0]!.opcoes.map((o) => o.id)).toEqual(['c-meu']);
  });

  it('sem nenhuma aposta em lugar nenhum, lista vazia', () => {
    const odds: OddsDaRodada = {
      roundId: 'r1',
      mercados: [{ marketId: 'm-dps', opcoes: [{ characterId: 'c-meu', multiplicador: null }] }],
    };
    expect(oddsComValor(CARDAPIO, odds)).toEqual([]);
  });
});
