import type { RosterSnapshot } from '../blizzard/blizzard.service';
import type { BlizzardService } from '../blizzard/blizzard.service';
import { OpsService } from './ops.service';

describe('OpsService.probeRoster', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.fetch = fetchMock;
  });

  function service(): OpsService {
    return new OpsService({} as unknown as BlizzardService);
  }

  it('monta a URL certa e devolve distribuição de rank ordenada', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          name: 'Titan Inc',
          realm: 'Azralon',
          faction: 'Horde',
          last_crawled_at: '2026-08-01T00:00:00Z',
          members: [
            { rank: 4, character: { name: 'Zenithus' } },
            { rank: 0, character: { name: 'Chefe' } },
            { rank: 4, character: { name: 'Outro' } },
          ],
        }),
        { status: 200 },
      ),
    );

    const resultado = await service().probeRoster('Titan Inc', 'Azralon', []);

    const url = (fetchMock.mock.calls[0] as [string, unknown])[0];
    expect(url).toContain('realm=azralon');
    expect(url).toContain('name=Titan%20Inc');

    expect(resultado.members).toBe(3);
    expect(resultado.rankDistribution).toEqual([
      { rank: 0, count: 1 },
      { rank: 4, count: 2 },
    ]);
  });

  it('reporta interseção por slug pros personagens pedidos', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          name: 'Titan Inc',
          realm: 'Azralon',
          faction: 'Horde',
          last_crawled_at: null,
          members: [{ rank: 5, character: { name: 'Shrëwd' } }],
        }),
        { status: 200 },
      ),
    );

    const resultado = await service().probeRoster('Titan Inc', 'Azralon', ['Shrewd', 'Ninguem']);

    expect(resultado.matches).toEqual([
      { input: 'Shrewd', found: true, character: 'Shrëwd', rank: 5 },
      { input: 'Ninguem', found: false },
    ]);
  });

  it('estoura em HTTP não-ok', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 400 }));
    await expect(service().probeRoster('X', 'Y', [])).rejects.toThrow('HTTP 400');
  });
});

describe('OpsService.checkOauth', () => {
  function snapshot(overrides: Partial<RosterSnapshot> = {}): RosterSnapshot {
    return {
      members: [
        { name: 'Zenithus', nameKey: 'zenithus', realmSlug: 'azralon', rank: 4 },
        { name: 'Chefe', nameKey: 'chefe', realmSlug: 'azralon', rank: 0 },
      ],
      fetchedAt: Date.now(),
      stale: false,
      ...overrides,
    };
  }

  it('sempre busca fresco (force: true) e propaga stale', async () => {
    const getGuildRosterSnapshot = jest.fn(() => Promise.resolve(snapshot({ stale: true })));
    const blizzard = { getGuildRosterSnapshot } as unknown as BlizzardService;

    const resultado = await new OpsService(blizzard).checkOauth([]);

    expect(getGuildRosterSnapshot).toHaveBeenCalledWith(true);
    expect(resultado.stale).toBe(true);
    expect(resultado.members).toBe(2);
  });

  it('reporta interseção por slug, igual o roster-probe', async () => {
    const blizzard = {
      getGuildRosterSnapshot: () => Promise.resolve(snapshot()),
    } as unknown as BlizzardService;

    const resultado = await new OpsService(blizzard).checkOauth(['Zenithus']);

    expect(resultado.matches).toEqual([
      { input: 'Zenithus', found: true, character: 'Zenithus', rank: 4 },
    ]);
  });
});
