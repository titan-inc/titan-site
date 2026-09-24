import { WarcraftLogsService } from './warcraftlogs.service';

/**
 * `getTitanBetReport` — a leitura do report oficial para o cálculo do Titan
 * Bet (spec §7.3, §15.10). Só forma de dados: as regras são do Titan Bet.
 * O `query` é substituído pela resposta no formato que a API v2 devolve
 * (medido no M0 e no gate #1).
 */
type Consulta = (query: string, variables?: Record<string, unknown>) => Promise<unknown>;

describe('WarcraftLogsService.getTitanBetReport', () => {
  let wcl: WarcraftLogsService;
  let query: jest.Mock<Promise<unknown>, Parameters<Consulta>>;

  beforeEach(() => {
    process.env.GUILD_NAME = 'Guilda';
    process.env.GUILD_REALM = 'Azralon';
    wcl = new WarcraftLogsService();
    query = jest.fn<Promise<unknown>, Parameters<Consulta>>();
    (wcl as unknown as { query: Consulta }).query = query;
  });

  const meta = {
    reportData: {
      report: {
        startTime: 1_000_000,
        revision: 7,
        fights: [
          { id: 1, encounterID: 501, difficulty: 5, kill: false, startTime: 0, endTime: 60_000 },
          {
            id: 2,
            encounterID: 501,
            difficulty: 5,
            kill: true,
            startTime: 70_000,
            endTime: 370_000,
          },
          {
            id: 3,
            encounterID: 777,
            difficulty: 5,
            kill: true,
            startTime: 400_000,
            endTime: 450_000,
          },
          {
            id: 4,
            encounterID: 501,
            difficulty: 4,
            kill: true,
            startTime: 500_000,
            endTime: 560_000,
          },
          {
            id: 5,
            encounterID: 0,
            difficulty: null,
            kill: null,
            startTime: 600_000,
            endTime: 610_000,
          },
        ],
        masterData: { actors: [{ id: 10, name: 'Fulano', server: 'Azralon' }] },
      },
    },
  };

  const ranking = (rankPercent: number) => ({
    data: [
      {
        fightID: 2,
        roles: {
          tanks: { characters: [] },
          healers: { characters: [] },
          dps: {
            characters: [
              {
                name: 'Fulano',
                server: { name: 'Azralon' },
                spec: 'Fury',
                amount: 100,
                rankPercent,
                bracketPercent: 1,
              },
            ],
          },
        },
      },
    ],
  });

  const detalhe = {
    reportData: {
      report: {
        mortes: { data: [{ fight: 1, targetID: 10, timestamp: 30_000 }], nextPageTimestamp: null },
        k2_dano: { data: { entries: [{ id: 10, name: 'Fulano', total: 30_000_000 }] } },
        k2_cura: { data: { entries: [] } },
        k2_dispels: { data: { entries: [] } },
        k2_dps: ranking(97),
        k2_hps: ranking(12),
      },
    },
  };

  it('pede as mortes das fights Mythic dos encounters pedidos e as tabelas só das kills', async () => {
    query.mockResolvedValueOnce(meta).mockResolvedValueOnce(detalhe);

    const r = await wcl.getTitanBetReport('AbC123', [501]);

    expect(r.code).toBe('AbC123');
    expect(r.startTime).toBe(1_000_000);
    // Todas as fights de boss Mythic voltam — o Titan Bet confere kills fora da Weekly.
    expect(r.fights.map((f) => f.id)).toEqual([1, 2, 3]);
    expect(r.actors).toEqual([{ id: 10, name: 'Fulano', server: 'Azralon' }]);
    expect(r.deaths).toEqual([{ fight: 1, targetID: 10, timestamp: 30_000 }]);
    expect(Object.keys(r.kills)).toEqual(['2']);
    expect(r.kills[2]!.damage).toEqual([{ id: 10, name: 'Fulano', total: 30_000_000 }]);
    expect(r.kills[2]!.rankingsDps[0]!.rankPercent).toBe(97);
    expect(r.kills[2]!.rankingsHps[0]!.rankPercent).toBe(12);

    const [consulta, variaveis] = query.mock.calls[1]!;
    expect(variaveis).toEqual({ c: 'AbC123', f: [1, 2] });
    // A variante validada no gate #1: Parse % = compare Rankings, timeframe Today.
    expect(consulta).toContain('compare: Rankings');
    expect(consulta).toContain('timeframe: Today');
    expect(consulta).toContain('dataType: Dispels');
    expect(consulta).toContain('hostilityType: Friendlies');
  });

  it('D-76: traz a revisão do report, lida na mesma consulta das fights — a proveniência do snapshot', async () => {
    query.mockResolvedValueOnce(meta).mockResolvedValueOnce(detalhe);
    const r = await wcl.getTitanBetReport('AbC123', [501]);
    expect(r.revision).toBe(7);
    expect(query.mock.calls[0]![0]).toMatch(/revision/);
  });

  it('D-76: report sem fight relevante também traz a revisão', async () => {
    query.mockResolvedValueOnce(meta);
    expect((await wcl.getTitanBetReport('AbC123', [999])).revision).toBe(7);
  });

  it('pagina as mortes até o fim', async () => {
    query
      .mockResolvedValueOnce(meta)
      .mockResolvedValueOnce({
        reportData: {
          report: {
            ...detalhe.reportData.report,
            mortes: { data: [{ fight: 1, targetID: 10, timestamp: 1 }], nextPageTimestamp: 50 },
          },
        },
      })
      .mockResolvedValueOnce({
        reportData: {
          report: {
            mortes: {
              data: [{ fight: 2, targetID: 10, timestamp: 90_000 }],
              nextPageTimestamp: null,
            },
          },
        },
      });

    const r = await wcl.getTitanBetReport('AbC123', [501]);
    expect(r.deaths.map((d) => d.timestamp)).toEqual([1, 90_000]);
    expect(query.mock.calls[2]![1]).toMatchObject({ c: 'AbC123', f: [1, 2], s: 50 });
  });

  // Achado da validação com WCL real (§40, B15): sem nenhuma fight Mythic dos
  // encounters pedidos, a consulta de mortes ia com `fightIDs: []`, que o WCL
  // recusa — e um `titanbet*` só com trash, ou só com boss fora da rodada,
  // derrubava o cálculo inteiro.
  it('report sem fight dos encounters pedidos: nenhuma consulta de detalhe, sem mortes nem kills', async () => {
    query.mockResolvedValueOnce(meta);

    const r = await wcl.getTitanBetReport('AbC123', [999]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(r.fights.map((f) => f.id)).toEqual([1, 2, 3]);
    expect(r.deaths).toEqual([]);
    expect(r.kills).toEqual({});
  });

  it('código de report fora do formato não vai para a query', async () => {
    await expect(wcl.getTitanBetReport('abc"){', [501])).rejects.toThrow(/código de report/);
    expect(query).not.toHaveBeenCalled();
  });
});
