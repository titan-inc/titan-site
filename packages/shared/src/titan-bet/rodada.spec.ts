import { describe, expect, it } from 'vitest';
import {
  faseDaRodadaSchema,
  rodadaDoMembroSchema,
  rodadasDoMembroSchema,
  rodadasDoOfficerSchema,
  slipsSubmetidosSchema,
} from './rodada.js';

/**
 * F0 — os contratos de leitura que o front precisa (titan-bet-test-design.md
 * §34.1): achar a rodada e ler o cardápio com nomes. Nenhum carrega aposta,
 * stake ou conta de outra pessoa (§16.10, D-36).
 */

const resumo = {
  roundId: 'r1',
  period: 1042,
  opensAt: '2026-09-22T15:00:00.000Z',
  cutoffAt: '2026-09-29T15:00:00.000Z',
  fase: 'OPEN',
};

describe('faseDaRodadaSchema — as fases da §16.5, derivadas, nunca coluna', () => {
  it.each([
    'PREPARATION',
    'NAO_ABERTA',
    'OPEN',
    'BETTING_CLOSED',
    'AUDITING',
    'CALCULATED',
    'SETTLED',
    'CLOSED',
  ])('%s', (fase) => {
    expect(faseDaRodadaSchema.parse(fase)).toBe(fase);
  });

  it('recusa o que não é fase', () => {
    expect(faseDaRodadaSchema.safeParse('ABERTA').success).toBe(false);
  });
});

describe('T-C01 — as rodadas visíveis à conta', () => {
  it('só o resumo de cada rodada', () => {
    const lista = { rodadas: [resumo] };
    expect(rodadasDoMembroSchema.parse(lista)).toEqual(lista);
  });

  it('é estrito: nada de slip, stake ou conta na lista', () => {
    expect(
      rodadasDoMembroSchema.safeParse({ rodadas: [{ ...resumo, slipId: 's1' }] }).success,
    ).toBe(false);
  });
});

describe('T-C03 — o cardápio da rodada para o membro (T-C02)', () => {
  const cardapio = {
    ...resumo,
    mercados: [
      {
        marketId: 'm1',
        kind: 'top_dps',
        boss: { roundEncounterId: 'e1', encounterName: 'Boss', track: 'farm' },
      },
      { marketId: 'm2', kind: 'weekly_progression', boss: null },
    ],
    bossesDeProgressao: [{ roundEncounterId: 'e2', encounterName: 'Outro Boss' }],
    candidatos: [{ characterId: 'c1', name: 'Alvo', realm: 'Azralon', role: 'Melee' }],
    podeApostar: true,
    personagensDoApostador: ['c9'],
  };

  it('mercados com o boss legível, candidatos com nome e role, e o que a conta pode fazer', () => {
    expect(rodadaDoMembroSchema.parse(cardapio)).toEqual(cardapio);
  });

  it('Weekly não tem boss (é da rodada, D-54); mercado de boss tem', () => {
    const semBoss = {
      ...cardapio,
      mercados: [{ marketId: 'm1', kind: 'top_dps', boss: null }],
    };
    expect(rodadaDoMembroSchema.safeParse(semBoss).success).toBe(false);
    const weeklyComBoss = {
      ...cardapio,
      mercados: [{ ...cardapio.mercados[1], boss: cardapio.mercados[0]!.boss }],
    };
    expect(rodadaDoMembroSchema.safeParse(weeklyComBoss).success).toBe(false);
  });

  it('é estrito: sem soma, stake nem odds aqui — odds têm rota própria (§16.10)', () => {
    expect(rodadaDoMembroSchema.safeParse({ ...cardapio, pool: 1000 }).success).toBe(false);
    const comStake = {
      ...cardapio,
      mercados: [{ ...cardapio.mercados[0], stake: 300 }],
    };
    expect(rodadaDoMembroSchema.safeParse(comStake).success).toBe(false);
  });
});

describe('T-C04 — as rodadas do Officer Panel', () => {
  it('o resumo, com o Ready', () => {
    const lista = {
      rodadas: [{ ...resumo, fase: 'PREPARATION', readyAt: null, readyByBattletag: null }],
    };
    expect(rodadasDoOfficerSchema.parse(lista)).toEqual(lista);
  });
});

describe('T-C05 — os slips submetidos da rodada, sem as escolhas', () => {
  const slip = {
    slipId: 's1',
    ownerBattletag: 'Membro#1234',
    status: 'valido',
    depositCharacter: { name: 'Depositante', realm: 'Azralon' },
    expectedTotal: 500,
    submittedAt: '2026-09-23T15:00:00.000Z',
  };

  it('dono, estado, depositante, total e horário', () => {
    expect(slipsSubmetidosSchema.parse({ slips: [slip] })).toEqual({ slips: [slip] });
  });

  it('rascunho não é submetido', () => {
    expect(
      slipsSubmetidosSchema.safeParse({ slips: [{ ...slip, status: 'rascunho' }] }).success,
    ).toBe(false);
  });

  it('é estrito: as apostas só pelo "ver slip", que registra o acesso (D-57)', () => {
    expect(slipsSubmetidosSchema.safeParse({ slips: [{ ...slip, apostas: [] }] }).success).toBe(
      false,
    );
  });
});
