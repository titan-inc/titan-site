import { describe, expect, it } from 'vitest';
import { PROGRESSAO_MOCK_PARCIAL } from '../mock/progressao.mock';
import { escolherDificuldade, escolherRaid, lerBoss } from './geometria';

describe('geometria da progressão', () => {
  it('escolhe a dificuldade mais alta com kill', () =>
    expect(
      escolherDificuldade({
        ...PROGRESSAO_MOCK_PARCIAL,
        difficulties: [
          { id: 4, name: 'Heroic' },
          { id: 5, name: 'Mythic' },
        ],
      }),
    ).toBe(5));
  it('usa a maior dificuldade quando não há kill', () =>
    expect(
      escolherDificuldade({
        ...PROGRESSAO_MOCK_PARCIAL,
        difficulties: [
          { id: 3, name: 'Normal' },
          { id: 5, name: 'Mythic' },
        ],
        raids: [],
      }),
    ).toBe(5));
  it('devolve sentinela sem dificuldades', () =>
    expect(escolherDificuldade({ ...PROGRESSAO_MOCK_PARCIAL, difficulties: [] })).toBe(-1));
  it('escolhe a raid com mais kills', () => {
    const segunda = {
      ...PROGRESSAO_MOCK_PARCIAL.raids[0],
      id: 2,
      bosses: PROGRESSAO_MOCK_PARCIAL.raids[0].bosses.slice(0, 2),
    };
    expect(
      escolherRaid(
        { ...PROGRESSAO_MOCK_PARCIAL, raids: [segunda, PROGRESSAO_MOCK_PARCIAL.raids[0]] },
        5,
      )?.id,
    ).toBe(1200);
  });
  it('desempata pela kill mais recente', () => {
    const base = PROGRESSAO_MOCK_PARCIAL.raids[0];
    const antiga = { ...base, id: 1 };
    const nova = {
      ...base,
      id: 2,
      bosses: base.bosses.map((boss, i) =>
        i === 0
          ? {
              ...boss,
              byDifficulty: [{ ...boss.byDifficulty[0], firstKillAt: '2026-08-01T00:00:00.000Z' }],
            }
          : boss,
      ),
    };
    expect(escolherRaid({ ...PROGRESSAO_MOCK_PARCIAL, raids: [antiga, nova] }, 5)?.id).toBe(2);
  });
  it('ignora raid sem id', () =>
    expect(
      escolherRaid(
        { ...PROGRESSAO_MOCK_PARCIAL, raids: [{ ...PROGRESSAO_MOCK_PARCIAL.raids[0], id: null }] },
        5,
      ),
    ).toBeNull());
  it('lê ausência sem inventar dado', () =>
    expect(lerBoss({ encounterId: 1, name: 'Boss', byDifficulty: [] }, 5)).toEqual({
      morto: false,
      pulls: 0,
      melhorPercentual: null,
      primeiraKill: null,
    }));
  it('preserva kill sem percentual', () =>
    expect(
      lerBoss(
        {
          encounterId: 1,
          name: 'Boss',
          byDifficulty: [
            { difficulty: 5, pulls: 1, kills: 1, firstKillAt: null, bestPercent: null },
          ],
        },
        5,
      ).morto,
    ).toBe(true));
});
