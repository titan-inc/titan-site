import { describe, expect, it } from 'vitest';
import {
  BONUS_TERTIARIES,
  escolherItemLevel,
  exibeValorDoTerciario,
  statsAdicionadosDe,
  terciariosDe,
} from './wow-bonus.js';

describe('exibeValorDoTerciario', () => {
  it('indestructible é flag — não mostra o número calculado', () => {
    expect(exibeValorDoTerciario(BONUS_TERTIARIES.INDESTRUCTIBLE)).toBe(false);
  });

  it('avoidance/leech/speed mostram o valor normal', () => {
    expect(exibeValorDoTerciario(BONUS_TERTIARIES.AVOIDANCE)).toBe(true);
    expect(exibeValorDoTerciario(BONUS_TERTIARIES.LEECH)).toBe(true);
    expect(exibeValorDoTerciario(BONUS_TERTIARIES.SPEED)).toBe(true);
  });
});

describe('terciariosDe', () => {
  it('deriva o terciário do statId E devolve a alocação junto', () => {
    // Bonus 41 do build 12.1.0: `Type 2 = "62,3000"`.
    expect(terciariosDe(statsAdicionadosDe({ statIds: [62], statAllocs: [3000] }))).toEqual([
      { tipo: 'leech', alocacao: 3000 },
    ]);
  });

  it('ignora os stats que não são terciário, e preserva o pareamento', () => {
    // O `Type 2` acrescenta qualquer stat, e quase sempre dois — aqui
    // versatility (40) e avoidance (63) no mesmo bonus.
    expect(
      terciariosDe(statsAdicionadosDe({ statIds: [40, 63], statAllocs: [1200, 6000] })),
    ).toEqual([{ tipo: 'avoidance', alocacao: 6000 }]);
  });

  it('bonus que não acrescenta stat nenhum devolve lista vazia', () => {
    expect(terciariosDe(statsAdicionadosDe({ statIds: [], statAllocs: [] }))).toEqual([]);
  });

  it('mais de um terciário no mesmo bonus vira mais de uma entrada', () => {
    expect(
      terciariosDe(statsAdicionadosDe({ statIds: [61, 62], statAllocs: [1925, 23892] })),
    ).toEqual([
      { tipo: 'speed', alocacao: 1925 },
      { tipo: 'leech', alocacao: 23892 },
    ]);
  });
});

describe('escolherItemLevel', () => {
  /**
   * O caso real do `Ancient Amani Greataxe`: duas listas do MESMO `itemString`
   * carregam `Type 49`, e o tooltip mostra 263.
   */
  it('o marcador 0 vence o marcador 1, venha na ordem que vier', () => {
    const menor = { itemLevel: 256, itemLevelMarcador: 1 };
    const maior = { itemLevel: 263, itemLevelMarcador: 0 };

    expect(escolherItemLevel([menor, maior])).toBe(263);
    expect(escolherItemLevel([maior, menor])).toBe(263);
  });

  it('marcador ausente conta como 0 e vence quem tem 1', () => {
    expect(
      escolherItemLevel([
        { itemLevel: 256, itemLevelMarcador: 1 },
        { itemLevel: 292, itemLevelMarcador: null },
      ]),
    ).toBe(292);
  });

  it('bonus sem itemLevel não concorre', () => {
    expect(
      escolherItemLevel([
        { itemLevel: null, itemLevelMarcador: 0 },
        { itemLevel: 305, itemLevelMarcador: null },
      ]),
    ).toBe(305);
  });

  it('nenhum candidato com ilvl devolve null — lacuna, nunca zero', () => {
    expect(escolherItemLevel([{ itemLevel: null, itemLevelMarcador: null }])).toBeNull();
    expect(escolherItemLevel([])).toBeNull();
  });

  it('marcadores iguais: o último vence, e não estoura', () => {
    expect(
      escolherItemLevel([
        { itemLevel: 292, itemLevelMarcador: 0 },
        { itemLevel: 295, itemLevelMarcador: 0 },
      ]),
    ).toBe(295);
  });
});
