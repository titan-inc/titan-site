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
  /**
   * Substituiu 'reutiliza a escolha da raid com mais kills'.
   *
   * O comportamento mudou de propósito: a season de 12.0 tem quatro raids
   * abertas, e destacar a de maior progresso mostrava `6/6` — parecia tier
   * fechado quando faltavam bosses em outra raid.
   */
  describe('com mais de uma raid na season', () => {
    const curta = {
      ...PROGRESSAO_MOCK_PARCIAL.raids[0],
      id: 2,
      name: 'Raid curta',
      bosses: PROGRESSAO_MOCK_PARCIAL.raids[0].bosses.slice(0, 2),
    };
    const report = {
      ...PROGRESSAO_MOCK_PARCIAL,
      raids: [PROGRESSAO_MOCK_PARCIAL.raids[0], curta],
    };

    it('soma a progressão de todas', () => {
      // 6/8 da primeira + 2/2 da curta.
      expect(resumirProgressaoNav(report)).toMatchObject({ vencidos: 8, total: 10 });
    });

    it('junta as siglas por barra', () =>
      expect(resumirProgressaoNav(report)?.raidSigla).toBe('CM / RC'));

    it('mantém os nomes completos para o title e o leitor de tela', () =>
      expect(resumirProgressaoNav(report)?.raidNome).toBe('Complexo Meridian, Raid curta'));

    it('emite uma marca por boss de todas as raids', () =>
      expect(resumirProgressaoNav(report)?.estados).toHaveLength(10));

    // Ordem do tier, não por progresso: ordenar por kills faria a barra se
    // reorganizar sozinha entre duas visitas.
    it('preserva a ordem do relatório', () =>
      expect(
        resumirProgressaoNav({ ...report, raids: [curta, PROGRESSAO_MOCK_PARCIAL.raids[0]] })
          ?.raidSigla,
      ).toBe('RC / CM'));

    it('ignora raid sem id do catálogo', () =>
      expect(
        resumirProgressaoNav({ ...report, raids: [...report.raids, { ...curta, id: null }] })
          ?.total,
      ).toBe(10));
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
