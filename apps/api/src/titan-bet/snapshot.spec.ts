import type { LeituraDoReport } from './leitura-wcl';
import { congelarReport, leituraDoSnapshot } from './snapshot';

/**
 * D-76 — o snapshot que o Auditar congela por report: só o que o cálculo usa,
 * projetado para os campos que o Titan Bet lê, com a proveniência. Nunca o
 * payload bruto do WCL.
 */
const RODADA = [501, 502];

/** Uma leitura como o WCL devolve, com campos que o Titan Bet não usa. */
function leitura(): LeituraDoReport {
  const extra = { guid: 123, icon: 'x.jpg', type: 'Warrior' };
  return {
    code: 'AbC123',
    startTime: 1_000_000,
    revision: 7,
    fights: [
      { id: 1, encounterID: 501, difficulty: 5, kill: false, startTime: 0, endTime: 60_000 },
      { id: 2, encounterID: 501, difficulty: 5, kill: true, startTime: 70_000, endTime: 370_000 },
      // Boss fora da rodada: nenhum mercado lê.
      { id: 3, encounterID: 777, difficulty: 5, kill: true, startTime: 400_000, endTime: 450_000 },
    ].map((f) => ({ ...f, ...extra })),
    actors: [
      { id: 10, name: 'Morreu', server: 'Azralon' },
      { id: 11, name: 'Causou', server: 'Azralon' },
      { id: 12, name: 'Dispelou', server: 'Goldrinn' },
      { id: 13, name: 'Curou', server: 'Azralon' },
      { id: 99, name: 'Ninguem', server: 'Azralon' },
    ].map((a) => ({ ...a, ...extra })),
    deaths: [
      { fight: 1, targetID: 10, timestamp: 30_000, ...extra },
      { fight: 3, targetID: 99, timestamp: 420_000, ...extra },
    ],
    kills: {
      2: {
        damage: [{ id: 11, name: 'Causou', total: 30_000_000, ...extra }],
        healing: [{ id: 13, name: 'Curou', total: 9_000_000, ...extra }],
        dispels: {
          entries: [
            {
              name: 'Debuff',
              ...extra,
              entries: [
                {
                  name: 'Magia',
                  ...extra,
                  details: [{ id: 12, name: 'Dispelou', total: 4, ...extra }],
                },
              ],
            },
          ],
        },
        rankingsDps: [
          {
            name: 'Causou',
            server: { name: 'Azralon', ...extra },
            spec: 'Fury',
            amount: 100_000,
            rankPercent: 97,
            bracketPercent: 3,
            ...extra,
          },
        ],
        rankingsHps: [],
      },
      3: {
        damage: [{ id: 99, name: 'Ninguem', total: 1 }],
        healing: [],
        dispels: { entries: [] },
        rankingsDps: [],
        rankingsHps: [],
      },
    },
  } as unknown as LeituraDoReport;
}

describe('congelarReport (D-76)', () => {
  const snap = () => congelarReport(leitura(), 'titanbet terça', RODADA);

  it('proveniência: versão, code, title, revision e início', () => {
    expect(snap()).toMatchObject({
      versao: 1,
      code: 'AbC123',
      title: 'titanbet terça',
      revision: 7,
      startTime: 1_000_000,
    });
  });

  it('só as fights dos encounters da rodada, e as mortes e kills delas', () => {
    const s = snap();
    expect(s.fights.map((f) => f.id)).toEqual([1, 2]);
    expect(s.deaths).toEqual([{ fight: 1, targetID: 10, timestamp: 30_000 }]);
    expect(Object.keys(s.kills)).toEqual(['2']);
  });

  it('só os atores que as mortes e as tabelas citam', () => {
    expect(snap().actors.map((a) => a.id)).toEqual([10, 11, 12, 13]);
  });

  it('projetado: nenhum campo do WCL que o Titan Bet não lê', () => {
    const json = JSON.stringify(snap());
    for (const campo of ['guid', 'icon', '"type"']) expect(json).not.toContain(campo);
    expect(snap().kills[2]!.rankingsDps[0]).toEqual({
      name: 'Causou',
      server: { name: 'Azralon' },
      spec: 'Fury',
      amount: 100_000,
      rankPercent: 97,
      bracketPercent: 3,
    });
    expect(snap().kills[2]!.dispels).toEqual({
      entries: [
        {
          name: 'Debuff',
          entries: [{ name: 'Magia', details: [{ id: 12, name: 'Dispelou', total: 4 }] }],
        },
      ],
    });
  });

  it('report sem fight relevante: congela vazio, com a proveniência', () => {
    const s = congelarReport(leitura(), 'titanbet', [999]);
    expect(s).toMatchObject({ revision: 7, fights: [], deaths: [], kills: {}, actors: [] });
  });
});

describe('leituraDoSnapshot (D-76)', () => {
  it('ida e volta em JSON: o cálculo lê do snapshot o mesmo que leria do WCL, recortado', () => {
    const s = congelarReport(leitura(), 'titanbet', RODADA);
    const lida = leituraDoSnapshot(JSON.parse(JSON.stringify(s)));
    expect(lida).toEqual({
      code: s.code,
      startTime: s.startTime,
      revision: s.revision,
      fights: s.fights,
      actors: s.actors,
      deaths: s.deaths,
      kills: s.kills,
    });
  });

  it('versão desconhecida, campo a mais ou campo faltando: recusa, não adivinha', () => {
    const s = JSON.parse(JSON.stringify(congelarReport(leitura(), 'titanbet', RODADA))) as Record<
      string,
      unknown
    >;
    expect(() => leituraDoSnapshot({ ...s, versao: 2 })).toThrow();
    expect(() => leituraDoSnapshot({ ...s, bruto: {} })).toThrow();
    const { revision: _r, ...semRevisao } = s;
    expect(() => leituraDoSnapshot(semRevisao)).toThrow();
    expect(() => leituraDoSnapshot(null)).toThrow();
  });
});
