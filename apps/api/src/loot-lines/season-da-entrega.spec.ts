import { seasonDaEntrega } from './season-da-entrega';

/** Datas fictícias, com a forma real: uma season por patch, meses de distância. */
const SEASONS = [
  { id: 17, startedAt: new Date('2026-03-17T15:00:00.000Z') },
  { id: 18, startedAt: new Date('2026-08-18T15:00:00.000Z') },
];

describe('seasonDaEntrega', () => {
  it('escolhe a season que já havia começado', () => {
    expect(seasonDaEntrega(new Date('2026-04-02T01:00:00.000Z'), SEASONS)).toBe(17);
    expect(seasonDaEntrega(new Date('2026-09-10T01:00:00.000Z'), SEASONS)).toBe(18);
  });

  it('a entrega no instante exato da virada é da season nova', () => {
    expect(seasonDaEntrega(new Date('2026-08-18T15:00:00.000Z'), SEASONS)).toBe(18);
  });

  it('um milissegundo antes da virada ainda é da season velha', () => {
    expect(seasonDaEntrega(new Date('2026-08-18T14:59:59.999Z'), SEASONS)).toBe(17);
  });

  it('não depende da ordem da lista', () => {
    // Vem de `findMany` sem `orderBy` — confiar na ordem do banco seria confiar
    // em algo que ninguém garantiu.
    const invertida = [...SEASONS].reverse();

    expect(seasonDaEntrega(new Date('2026-09-10T01:00:00.000Z'), invertida)).toBe(18);
  });

  describe('quando não dá para datar', () => {
    it('entrega anterior a toda season conhecida fica sem season', () => {
      // Lacuna, nunca a season mais próxima: chutar poria loot na season errada
      // sem erro nenhum, e o sintoma só apareceria meses depois num relatório.
      expect(seasonDaEntrega(new Date('2026-01-01T00:00:00.000Z'), SEASONS)).toBeNull();
    });

    it('sem season nenhuma carregada, devolve nulo em vez de estourar', () => {
      // Acontece se o import rodar antes de o job de snapshot criar a season.
      expect(seasonDaEntrega(new Date('2026-04-02T01:00:00.000Z'), [])).toBeNull();
    });
  });
});
