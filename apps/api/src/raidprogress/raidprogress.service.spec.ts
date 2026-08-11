import type { SnapshotsRepository } from '../snapshots/snapshots.repository';
import type {
  RaidCatalog,
  RaidEncounter,
  RaidPull,
  WarcraftLogsService,
} from '../warcraftlogs/warcraftlogs.service';
import { RaidProgressService } from './raidprogress.service';

process.env.GUILD_NAME = 'Guilda de Teste';
process.env.GUILD_REALM = 'Realm de Teste';

const season = (over: Record<string, unknown> = {}) => ({
  id: 17,
  name: 'Season de Teste',
  patch: '12.0',
  firstPeriod: 1055,
  periodCount: 20,
  startedAt: new Date('2026-03-17T15:00:00Z'),
  ...over,
});

/**
 * Um tier com 4 bosses espalhados por duas raids do jogo — que é o caso desta
 * season, e o motivo de a raid não poder ser a zona do WCL.
 */
const RAID_UM = { id: 2912, name: 'Raid Um' };
const RAID_DOIS = { id: 2913, name: 'Raid Dois' };

const bosses: RaidEncounter[] = [
  { id: 3176, name: 'Boss A', zoneId: 46, zoneName: 'Tier de Teste', order: 0 },
  { id: 3177, name: 'Boss B', zoneId: 46, zoneName: 'Tier de Teste', order: 1 },
  { id: 3182, name: 'Boss C', zoneId: 46, zoneName: 'Tier de Teste', order: 2 },
  { id: 3183, name: 'Boss D', zoneId: 46, zoneName: 'Tier de Teste', order: 3 },
];

const catalogo: RaidCatalog = {
  encounters: new Map(bosses.map((b) => [b.id, b])),
  zones: new Map([[46, bosses]]),
  difficultyNames: new Map([
    [5, 'Mythic'],
    [4, 'Heroic'],
  ]),
};

const pull = (over: Partial<RaidPull> = {}): RaidPull => ({
  encounterId: 3176,
  difficulty: 5,
  kill: false,
  fightPercentage: 40,
  startedAt: Date.parse('2026-04-01T22:00:00Z'),
  gameZoneId: RAID_UM.id,
  gameZoneName: RAID_UM.name,
  ...over,
});

describe('RaidProgressService', () => {
  const repo = { listSeasons: jest.fn(), findSeason: jest.fn() };
  const wcl = { getRaidCatalog: jest.fn(), getRaidPulls: jest.fn() };

  let service: RaidProgressService;

  const criar = () =>
    new RaidProgressService(
      repo as unknown as SnapshotsRepository,
      wcl as unknown as WarcraftLogsService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    repo.listSeasons.mockResolvedValue([season()]);
    repo.findSeason.mockResolvedValue(season());
    wcl.getRaidCatalog.mockResolvedValue(catalogo);
    wcl.getRaidPulls.mockResolvedValue([]);
    service = criar();
  });

  it('devolve null quando não há season gravada', async () => {
    repo.listSeasons.mockResolvedValue([]);

    await expect(service.getReport()).resolves.toBeNull();
  });

  it('separa as raids do tier pelo gameZone da pull', async () => {
    // O WCL junta o tier inteiro numa zona só ("VS / DR / MQD"). Agrupar por
    // zona mostraria um bloco que o time não reconhece — quem separa é a
    // instância do jogo.
    wcl.getRaidPulls.mockResolvedValue([
      pull({ encounterId: 3176, kill: true }),
      pull({ encounterId: 3177 }),
      pull({ encounterId: 3182, gameZoneId: RAID_DOIS.id, gameZoneName: RAID_DOIS.name }),
      pull({ encounterId: 3183, gameZoneId: RAID_DOIS.id, gameZoneName: RAID_DOIS.name }),
    ]);

    const report = await service.getReport();

    expect(report?.raids.map((r) => r.name)).toEqual(['Raid Um', 'Raid Dois']);
    expect(report?.raids[0]?.bosses.map((b) => b.name)).toEqual(['Boss A', 'Boss B']);
    expect(report?.raids[0]?.tier).toBe('Tier de Teste');
  });

  it('ordena raids e bosses pela ordem da raid, não pela ordem das pulls', async () => {
    wcl.getRaidPulls.mockResolvedValue([
      pull({ encounterId: 3183, gameZoneId: RAID_DOIS.id, gameZoneName: RAID_DOIS.name }),
      pull({ encounterId: 3177 }),
      pull({ encounterId: 3182, gameZoneId: RAID_DOIS.id, gameZoneName: RAID_DOIS.name }),
      pull({ encounterId: 3176 }),
    ]);

    const report = await service.getReport();

    expect(report?.raids.map((r) => r.id)).toEqual([RAID_UM.id, RAID_DOIS.id]);
    expect(report?.raids[1]?.bosses.map((b) => b.name)).toEqual(['Boss C', 'Boss D']);
  });

  it('boss sem pull nenhuma vira grupo próprio e continua contando no total', async () => {
    // Esconder quem ninguém tocou faria o "2/2" dizer que o tier acabou.
    wcl.getRaidPulls.mockResolvedValue([
      pull({ encounterId: 3176, kill: true }),
      pull({ encounterId: 3177, kill: true }),
    ]);

    const report = await service.getReport();

    const semPull = report?.raids.find((r) => r.id === null);
    expect(semPull?.bosses.map((b) => b.name)).toEqual(['Boss C', 'Boss D']);
    expect(semPull?.tier).toBe('Tier de Teste');
    // Sem pull não há gameZone, então não dá para dizer em qual raid o boss
    // está. O grupo existe justamente para não chutar.
    expect(semPull?.bosses[0]?.byDifficulty).toEqual([]);
  });

  it('melhor wipe é o menor % entre wipes, e kill não conta como 0%', async () => {
    wcl.getRaidPulls.mockResolvedValue([
      pull({ fightPercentage: 60 }),
      pull({ fightPercentage: 12.5 }),
      pull({ fightPercentage: 30 }),
      pull({ kill: true, fightPercentage: 0 }),
    ]);

    const report = await service.getReport();
    const estado = report?.raids[0]?.bosses[0]?.byDifficulty[0];

    expect(estado?.bestPercent).toBe(12.5);
    expect(estado?.pulls).toBe(4);
    expect(estado?.kills).toBe(1);
  });

  it('sem wipe nenhum, o melhor wipe é null e não zero', async () => {
    wcl.getRaidPulls.mockResolvedValue([pull({ kill: true }), pull({ kill: true })]);

    const report = await service.getReport();

    expect(report?.raids[0]?.bosses[0]?.byDifficulty[0]?.bestPercent).toBeNull();
  });

  it('a primeira kill é a mais antiga, mesmo chegando fora de ordem', async () => {
    const cedo = Date.parse('2026-04-10T23:00:00Z');
    wcl.getRaidPulls.mockResolvedValue([
      pull({ kill: true, startedAt: Date.parse('2026-06-20T23:00:00Z') }),
      pull({ kill: true, startedAt: cedo }),
    ]);

    const report = await service.getReport();

    expect(report?.raids[0]?.bosses[0]?.byDifficulty[0]?.firstKillAt).toBe(
      new Date(cedo).toISOString(),
    );
  });

  it('separa dificuldades e devolve da mais alta para a mais baixa', async () => {
    wcl.getRaidPulls.mockResolvedValue([
      pull({ difficulty: 4, kill: true }),
      pull({ difficulty: 5 }),
      pull({ difficulty: 5 }),
    ]);

    const report = await service.getReport();

    expect(report?.difficulties).toEqual([
      { id: 5, name: 'Mythic' },
      { id: 4, name: 'Heroic' },
    ]);

    const porDificuldade = report?.raids[0]?.bosses[0]?.byDifficulty;
    expect(porDificuldade?.map((d) => [d.difficulty, d.pulls, d.kills])).toEqual([
      [5, 2, 0],
      [4, 1, 1],
    ]);
  });

  it('a janela da season termina onde a próxima começa', async () => {
    const antiga = season({ id: 17, startedAt: new Date('2026-03-17T15:00:00Z') });
    const nova = season({ id: 18, startedAt: new Date('2026-08-18T15:00:00Z') });
    repo.listSeasons.mockResolvedValue([nova, antiga]);
    repo.findSeason.mockResolvedValue(antiga);

    await service.getReport(17);

    expect(wcl.getRaidPulls).toHaveBeenCalledWith(antiga.startedAt, nova.startedAt);
  });

  it('a season corrente não tem fim: a janela vai até agora', async () => {
    await service.getReport();

    expect(wcl.getRaidPulls).toHaveBeenCalledWith(season().startedAt, null);
  });

  describe('qual season abre sozinha', () => {
    const antiga = season({ id: 17, patch: '12.0', startedAt: new Date('2026-03-17T15:00:00Z') });
    const nova = season({ id: 18, patch: '12.1', startedAt: new Date('2026-08-11T15:00:00Z') });

    /** Season nova recém-criada pelo snapshot: existe, e ainda não teve raid. */
    const soAAntigaTemPull = () =>
      wcl.getRaidPulls.mockImplementation((inicio: Date) =>
        inicio.getTime() === nova.startedAt.getTime() ? [] : [pull({ kill: true })],
      );

    beforeEach(() => {
      repo.listSeasons.mockResolvedValue([nova, antiga]);
    });

    it('é a mais recente com pull, não a mais nova vazia', async () => {
      // 11/08/2026: a season nasce no dia do patch, antes da primeira noite de
      // raid. Abrir nela trocava a progressão do tier por "nenhuma pull".
      soAAntigaTemPull();

      const report = await service.getReport();

      expect(report?.season.id).toBe(17);
    });

    it('mesmo assim o seletor lista as duas', async () => {
      soAAntigaTemPull();

      const report = await service.getReport();

      expect(report?.availableSeasons.map((s) => s.id)).toEqual([18, 17]);
    });

    it('season pedida à mão vale mesmo vazia', async () => {
      soAAntigaTemPull();
      repo.findSeason.mockResolvedValue(nova);

      const report = await service.getReport(18);

      expect(report?.season.id).toBe(18);
      expect(report?.raids).toEqual([]);
    });

    it('sem pull em season nenhuma, abre na mais recente e mostra o vazio', async () => {
      wcl.getRaidPulls.mockResolvedValue([]);

      const report = await service.getReport();

      expect(report?.season.id).toBe(18);
      expect(report?.raids).toEqual([]);
    });
  });

  it('degrada para o cache anterior quando o WCL cai, rotulado como velho', async () => {
    // Regra 6: falha de API externa não derruba página. Mas o dado velho tem
    // que sair marcado — progressão desatualizada com cara de atual é pior.
    await service.getReport();
    wcl.getRaidPulls.mockRejectedValue(new Error('WCL fora do ar'));

    // O cache do relatório tem TTL; passar do TTL força a releitura.
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60 * 60 * 1000);
    const report = await service.getReport();

    expect(report?.stale).toBe(true);
    jest.restoreAllMocks();
  });

  it('sem cache anterior, a falha do WCL sobe em vez de virar relatório vazio', async () => {
    // Relatório vazio diria "o time não matou nada", que é outra coisa.
    wcl.getRaidPulls.mockRejectedValue(new Error('WCL fora do ar'));

    await expect(service.getReport()).rejects.toThrow('Warcraft Logs');
  });
});
