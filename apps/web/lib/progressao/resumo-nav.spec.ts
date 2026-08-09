import { describe, expect, it } from 'vitest';
import {
  PROGRESSAO_MOCK_COMPLETA,
  PROGRESSAO_MOCK_PARCIAL,
  PROGRESSAO_MOCK_TRES_BOSSES,
  PROGRESSAO_MOCK_ZERO,
} from '../mock/progressao.mock';
import { resumirProgressaoNav } from './resumo-nav';

describe('resumo da progressão na navbar', () => {
  it('resume 6/8 mantendo uma marca por boss', () => {
    const resumo = resumirProgressaoNav(PROGRESSAO_MOCK_PARCIAL, true);
    expect(resumo).toMatchObject({ vencidos: 6, total: 8, dificuldadeNome: 'Mítico' });
    expect(resumo?.estados).toEqual([true, true, true, true, true, true, false, false]);
  });
  it('representa zero kills', () =>
    expect(resumirProgressaoNav(PROGRESSAO_MOCK_ZERO)?.vencidos).toBe(0));
  it('representa progressão completa', () =>
    expect(resumirProgressaoNav(PROGRESSAO_MOCK_COMPLETA)?.vencidos).toBe(8));
  it('preserva totais variáveis', () =>
    expect(resumirProgressaoNav(PROGRESSAO_MOCK_TRES_BOSSES)).toMatchObject({
      vencidos: 2,
      total: 3,
    }));
  it('representa uma raid com um boss', () => {
    const report = {
      ...PROGRESSAO_MOCK_PARCIAL,
      raids: [
        {
          ...PROGRESSAO_MOCK_PARCIAL.raids[0],
          bosses: PROGRESSAO_MOCK_PARCIAL.raids[0].bosses.slice(0, 1),
        },
      ],
    };
    expect(resumirProgressaoNav(report)?.estados).toEqual([true]);
  });
  it('reutiliza a escolha da raid com mais kills', () => {
    const curta = {
      ...PROGRESSAO_MOCK_PARCIAL.raids[0],
      id: 2,
      name: 'Raid curta',
      bosses: PROGRESSAO_MOCK_PARCIAL.raids[0].bosses.slice(0, 2),
    };
    expect(
      resumirProgressaoNav({
        ...PROGRESSAO_MOCK_PARCIAL,
        raids: [curta, PROGRESSAO_MOCK_PARCIAL.raids[0]],
      })?.raidNome,
    ).toBe('Complexo Meridian');
  });
  it('degrada sem dificuldades', () =>
    expect(resumirProgressaoNav({ ...PROGRESSAO_MOCK_PARCIAL, difficulties: [] })).toBeNull());
  it('degrada sem bosses', () =>
    expect(
      resumirProgressaoNav({
        ...PROGRESSAO_MOCK_PARCIAL,
        raids: [{ ...PROGRESSAO_MOCK_PARCIAL.raids[0], bosses: [] }],
      }),
    ).toBeNull());
  it('degrada com relatório nulo', () => expect(resumirProgressaoNav(null)).toBeNull());
  it('marca desenvolvimento somente quando solicitado', () => {
    expect(resumirProgressaoNav(PROGRESSAO_MOCK_PARCIAL)?.desenvolvimento).toBe(false);
    expect(resumirProgressaoNav(PROGRESSAO_MOCK_PARCIAL, true)?.desenvolvimento).toBe(true);
  });
});
