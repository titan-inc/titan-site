import {
  dispelsPorAtor,
  identificarAtor,
  pullsDoReport,
  valoresDaKill,
  type CandidatoIdentificavel,
  type LeituraDoReport,
} from './leitura-wcl';

/**
 * Do report do WCL para o domínio de resultados (D-43, D-47; spec §7.3,
 * §15.10). O formato das entradas é o que a API v2 devolve, medido no M0 e no
 * gate #1 (§15.0). titan-bet-test-design.md §3.16.
 */

const CANDIDATOS: CandidatoIdentificavel[] = [
  { characterId: 'c-shrewd', name: 'Shrëwd', realm: 'Azralon', role: 'Melee' },
  { characterId: 'c-kusiak', name: 'Kusiak', realm: 'Area 52', role: 'Ranged' },
  { characterId: 'c-cura', name: 'Curandeira', realm: 'Azralon', role: 'Heal' },
];

/** Um report com uma kill (fight 3) e duas tries (1, 2), início às 21:00. */
const REPORT: LeituraDoReport = {
  code: 'AbC123',
  startTime: 1_000_000,
  fights: [
    { id: 1, encounterID: 501, difficulty: 5, kill: false, startTime: 0, endTime: 60_000 },
    { id: 2, encounterID: 501, difficulty: 5, kill: false, startTime: 90_000, endTime: 150_000 },
    { id: 3, encounterID: 502, difficulty: 5, kill: true, startTime: 200_000, endTime: 440_000 },
    { id: 4, encounterID: 999, difficulty: 5, kill: true, startTime: 500_000, endTime: 560_000 },
  ],
  actors: [
    { id: 10, name: 'Shrëwd', server: 'Azralon' },
    { id: 11, name: 'Shrewd', server: 'Azralon' },
    { id: 12, name: 'Kusiak', server: 'Area52' },
    { id: 13, name: 'Curandeira', server: 'Azralon' },
  ],
  deaths: [
    { fight: 1, targetID: 11, timestamp: 30_000 },
    { fight: 1, targetID: 10, timestamp: 31_000 },
    { fight: 2, targetID: 12, timestamp: 120_000 },
    { fight: 3, targetID: 13, timestamp: 300_000 },
  ],
  kills: {
    3: {
      damage: [
        { id: 10, name: 'Shrëwd', total: 48_000_000 },
        { id: 12, name: 'Kusiak', total: 60_000_000 },
        { id: 11, name: 'Shrewd', total: 90_000_000 },
      ],
      healing: [{ id: 13, name: 'Curandeira', total: 72_000_000 }],
      dispels: {
        entries: [
          {
            name: 'Grupo',
            entries: [
              { name: 'Debuff A', details: [{ id: 13, name: 'Curandeira', total: 3 }] },
              {
                name: 'Debuff B',
                details: [
                  { id: 13, name: 'Curandeira', total: 2 },
                  { id: 10, name: 'Shrëwd', total: 1 },
                ],
              },
            ],
          },
        ],
      },
      rankingsDps: [
        {
          name: 'Shrëwd',
          server: { name: 'Azralon' },
          spec: 'Fury',
          amount: 200_000,
          rankPercent: 91,
          bracketPercent: 80,
        },
        {
          name: 'Kusiak',
          server: { name: 'Area 52' },
          spec: 'Demonology',
          amount: 250_000,
          rankPercent: 77,
          bracketPercent: 95,
        },
      ],
      rankingsHps: [
        {
          name: 'Curandeira',
          server: { name: 'Azralon' },
          spec: 'Holy',
          amount: 300_000,
          rankPercent: 64,
          bracketPercent: 99,
        },
      ],
    },
  },
};

const ENCOUNTERS = new Map([
  [501, 're-prog'],
  [502, 're-farm'],
]);

describe('identificarAtor — nome + realm, com as normalizações da Regra 6', () => {
  it('casa realm escrito de jeitos diferentes (Area52 × Area 52)', () => {
    expect(identificarAtor({ name: 'Kusiak', server: 'Area52' }, CANDIDATOS)).toBe('c-kusiak');
  });

  it('acento no nome é identidade: Shrewd não é Shrëwd', () => {
    expect(identificarAtor({ name: 'Shrëwd', server: 'Azralon' }, CANDIDATOS)).toBe('c-shrewd');
    expect(identificarAtor({ name: 'Shrewd', server: 'Azralon' }, CANDIDATOS)).toBeNull();
  });

  it('mesmo nome em outro realm não é o candidato', () => {
    expect(identificarAtor({ name: 'Kusiak', server: 'Azralon' }, CANDIDATOS)).toBeNull();
  });
});

describe('pullsDoReport — pulls do report oficial, na sessão do report (D-26)', () => {
  const pulls = pullsDoReport(REPORT, 'terca', ENCOUNTERS, CANDIDATOS);

  it('só encounters da rodada; horário absoluto = início do report + offset', () => {
    expect(pulls.map((p) => [p.encounterId, p.kill, p.startTime, p.session])).toEqual([
      ['re-prog', false, 1_000_000, 'terca'],
      ['re-prog', false, 1_090_000, 'terca'],
      ['re-farm', true, 1_200_000, 'terca'],
    ]);
  });

  it('cada pull sabe de que report veio — é o que a consolidação usa (D-63)', () => {
    expect(new Set(pulls.map((p) => p.report))).toEqual(new Set([REPORT.code]));
  });

  it('morte de quem não é candidato continua na lista, fora do snapshot (D-13)', () => {
    // N1: a morte leva também o ator do report — é por ele que a evidência
    // mostra nome e servidor de quem morreu, inclusive os de fora (§15.10).
    expect(pulls[0]!.deaths).toEqual([
      { characterId: 'fora:11', timestamp: 1_030_000, ator: 11 },
      { characterId: 'c-shrewd', timestamp: 1_031_000, ator: 10 },
    ]);
  });
});

describe('valoresDaKill — o valor que a tabela do WCL exibe (D-47)', () => {
  const kill = { fight: REPORT.fights[2]!, leitura: REPORT.kills[3]! };

  it('Top DPS: total ÷ duração da luta — a coluna DPS de Damage Done', () => {
    const v = valoresDaKill('top_dps', kill, REPORT, CANDIDATOS);
    // 240 s de luta.
    expect(v.map((x) => [x.characterId, x.valor])).toEqual([
      ['c-shrewd', 200_000],
      ['c-kusiak', 250_000],
    ]);
    expect(v[0]!.evidencia).toEqual({ name: 'Shrëwd', server: 'Azralon', total: 48_000_000 });
  });

  it('Top HPS: total de Healing (com absorb) ÷ duração', () => {
    const v = valoresDaKill('top_hps', kill, REPORT, CANDIDATOS);
    expect(v.map((x) => [x.characterId, x.valor])).toEqual([['c-cura', 300_000]]);
  });

  it('Parse %: rankPercent de dps (compare Rankings, Today), com a variante na evidência', () => {
    const v = valoresDaKill('top_dps_parse', kill, REPORT, CANDIDATOS);
    expect(v.map((x) => [x.characterId, x.valor])).toEqual([
      ['c-shrewd', 91],
      ['c-kusiak', 77],
    ]);
    expect(v[1]!.evidencia).toEqual({
      name: 'Kusiak',
      server: 'Area 52',
      spec: 'Demonology',
      metric: 'dps',
      compare: 'Rankings',
      timeframe: 'Today',
      rankPercent: 77,
      bracketPercent: 95,
    });
  });

  it('Top HPS Parse: rankPercent de hps; nunca o bracketPercent (ilvl %, D-43)', () => {
    const v = valoresDaKill('top_hps_parse', kill, REPORT, CANDIDATOS);
    expect(v.map((x) => [x.characterId, x.valor])).toEqual([['c-cura', 64]]);
  });

  it('Top Dispels: a soma da tabela de Dispels por jogador', () => {
    const v = valoresDaKill('top_dispels', kill, REPORT, CANDIDATOS);
    expect(v.map((x) => [x.characterId, x.valor])).toEqual([
      ['c-cura', 5],
      ['c-shrewd', 1],
    ]);
  });

  it('quem não é candidato não entra; candidato sem linha não produz valor (≠ 0)', () => {
    const v = valoresDaKill('top_dps', kill, REPORT, CANDIDATOS);
    expect(v.map((x) => x.characterId)).not.toContain('fora:11');
    expect(v.map((x) => x.characterId)).not.toContain('c-cura');
  });
});

describe('dispelsPorAtor — a tabela de Dispels agrupa por debuff removido', () => {
  it('soma os details de cada ator em todos os debuffs', () => {
    expect(dispelsPorAtor(REPORT.kills[3]!.dispels)).toEqual(
      new Map([
        [13, { name: 'Curandeira', total: 5 }],
        [10, { name: 'Shrëwd', total: 1 }],
      ]),
    );
  });

  it('tabela vazia → nenhum dispel, sem erro', () => {
    expect(dispelsPorAtor({ entries: [] }).size).toBe(0);
  });
});
