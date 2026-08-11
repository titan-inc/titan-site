import { RaidDifficulty, WowSpec } from '@prisma/client';
import { PRIMARY_STATS, RAID_DIFFICULTIES, SPECS, type CatalogFile } from '@titan/shared';
import type { WarcraftLogsService } from '../warcraftlogs/warcraftlogs.service';
import type { LootCatalogRepository } from './loot-catalog.repository';
import { LootCatalogService } from './loot-catalog.service';

/** Linha crua do Prisma: specs vêm como enum do banco, com underscore. */
const itemRow = (itemId: number, over: Record<string, unknown> = {}) => ({
  itemId,
  name: null,
  icon: null,
  equipLoc: null,
  itemSubclass: null,
  primaryStats: [],
  specsCuratedAt: null,
  usableBySpecs: [],
  ...over,
});

/** O mesmo item já traduzido para o contrato do shared. */
const item = (itemId: number, over: Record<string, unknown> = {}) => ({
  itemId,
  name: null,
  icon: null,
  equipLoc: null,
  itemSubclass: null,
  primaryStats: [],
  usableBySpecs: [],
  specsCuratedAt: null,
  ...over,
});

/** Uma raid com dois bosses, o segundo cadastrado fora de ordem no array. */
const raidRow = (over: Record<string, unknown> = {}) => ({
  id: 'ckraid',
  slug: 'the-voidspire',
  name: 'The Voidspire',
  seasonId: null,
  instanceMapId: 2569,
  encounters: [
    {
      id: 'ckboss0',
      name: 'Boss A',
      position: 0,
      dungeonEncounterId: 2687,
      drops: [
        { difficulty: RaidDifficulty.mythic, item: itemRow(249276) },
        { difficulty: RaidDifficulty.heroic, item: itemRow(249276) },
      ],
    },
    {
      id: 'ckboss1',
      name: 'Boss B',
      position: 1,
      // Nulo de propósito: boss cadastrado antes de alguém buscar o id no WCL.
      dungeonEncounterId: null,
      drops: [],
    },
  ],
  ...over,
});

/** Falha com mensagem útil em vez de `!`, que o lint não aceita. */
function primeira<T>(itens: T[]): T {
  const [primeiro] = itens;
  if (!primeiro) throw new Error('esperava pelo menos uma raid');
  return primeiro;
}

/** Arquivo mínimo válido, com um boss e um item. */
const arquivo = (over: Record<string, unknown> = {}): CatalogFile => ({
  version: 1,
  slug: 'the-voidspire',
  name: 'The Voidspire',
  bosses: [
    {
      name: 'Imperator Averzian',
      position: 0,
      dungeonEncounterId: 2900,
      difficulties: [RAID_DIFFICULTIES.NORMAL, RAID_DIFFICULTIES.HEROIC, RAID_DIFFICULTIES.MYTHIC],
      items: [{ itemId: 249344 }],
    },
  ],
  ...over,
});

/** Catálogo do WCL com o boss que o arquivo declara. */
const catalogoWcl = (nome = 'Imperator Averzian') => ({
  encounters: new Map([[2900, { id: 2900, name: nome, zoneId: 46, zoneName: 'Tier', order: 0 }]]),
  zones: new Map(),
  difficultyNames: new Map(),
});

describe('LootCatalogService', () => {
  const repo = {
    findRaids: jest.fn(),
    findRaidSummaries: jest.fn(),
    findRaidBySlug: jest.fn(),
    upsertRaid: jest.fn(),
    upsertEncounter: jest.fn(),
    upsertItem: jest.fn(),
    replaceDrops: jest.fn(),
  };
  const wcl = { getRaidCatalog: jest.fn() };
  let service: LootCatalogService;

  beforeEach(() => {
    jest.resetAllMocks();
    repo.upsertRaid.mockResolvedValue({ id: 'ckraid' });
    repo.upsertEncounter.mockResolvedValue({ id: 'ckboss' });
    repo.upsertItem.mockResolvedValue(undefined);
    repo.replaceDrops.mockResolvedValue(undefined);
    wcl.getRaidCatalog.mockResolvedValue(catalogoWcl());

    service = new LootCatalogService(
      repo as unknown as LootCatalogRepository,
      wcl as unknown as WarcraftLogsService,
    );
  });

  it('traduz a raid para o contrato do shared', async () => {
    repo.findRaids.mockResolvedValue([raidRow()]);

    const raid = primeira(await service.listRaids());

    expect(raid).toMatchObject({ slug: 'the-voidspire', seasonId: null, instanceMapId: 2569 });
    // O id do jogo atravessa até o contrato: é o que casa a colagem do addon com
    // o boss, e é o que o cadastro confere contra o Warcraft Logs.
    expect(raid.encounters.map((e) => e.dungeonEncounterId)).toEqual([2687, null]);
    expect(raid.encounters.map((e) => e.drops)).toEqual([
      [
        { difficulty: RAID_DIFFICULTIES.MYTHIC, item: item(249276) },
        { difficulty: RAID_DIFFICULTIES.HEROIC, item: item(249276) },
      ],
      [],
    ]);
  });

  it('resume a raid sem os drops, com a contagem de bosses', async () => {
    // A lista existe para não trafegar meio megabyte de drops só para escolher
    // qual raid abrir. O `_count` do Prisma vira `encounterCount` no contrato.
    repo.findRaidSummaries.mockResolvedValue([
      {
        id: 'ckraid',
        slug: 'the-voidspire',
        name: 'The Voidspire',
        seasonId: null,
        instanceMapId: 2912,
        _count: { encounters: 6 },
      },
    ]);

    const resumos = await service.listRaidSummaries();

    expect(primeira(resumos)).toEqual({
      id: 'ckraid',
      slug: 'the-voidspire',
      name: 'The Voidspire',
      seasonId: null,
      instanceMapId: 2912,
      encounterCount: 6,
    });
  });

  it('mantém o boss que não tem drop na dificuldade filtrada', async () => {
    // Lista vazia é a resposta certa para "o que este boss solta no mítico?"
    // quando ainda não cadastraram nada. Sumir com o boss faria parecer que ele
    // não existe na raid.
    repo.findRaids.mockResolvedValue([raidRow()]);

    const raid = primeira(await service.listRaids({ difficulty: RAID_DIFFICULTIES.MYTHIC }));

    expect(raid.encounters.map((e) => e.name)).toEqual(['Boss A', 'Boss B']);
    expect(raid.encounters.map((e) => e.drops.length)).toEqual([2, 0]);
  });

  it('repassa o filtro para o repository em vez de filtrar em memória', async () => {
    repo.findRaids.mockResolvedValue([]);

    await service.listRaids({ seasonId: 17, difficulty: RAID_DIFFICULTIES.HEROIC });

    expect(repo.findRaids).toHaveBeenCalledWith({
      seasonId: 17,
      difficulty: RAID_DIFFICULTIES.HEROIC,
    });
  });

  it('distingue "sem season" de "todas as seasons"', async () => {
    // `seasonId: null` é filtro — as raids ainda não ligadas a uma season.
    // Omitir o campo é que significa todas. Colapsar os dois esconderia
    // justamente as raids recém-cadastradas.
    repo.findRaids.mockResolvedValue([]);

    await service.listRaids({ seasonId: null });
    expect(repo.findRaids).toHaveBeenCalledWith({ seasonId: null });

    await service.listRaids();
    expect(repo.findRaids).toHaveBeenLastCalledWith({});
  });

  it('devolve null quando a raid não existe', async () => {
    repo.findRaidBySlug.mockResolvedValue(null);

    expect(await service.getRaid('nao-existe')).toBeNull();
  });

  describe('carregarArquivo', () => {
    it('expande item por dificuldade', async () => {
      // O journal da Blizzard dá uma lista de itens e um conjunto de
      // dificuldades, sem dizer quais itens existem em quais. O padrão é o
      // produto cartesiano: um item em três dificuldades vira três drops.
      const r = await service.carregarArquivo(arquivo());

      expect(repo.replaceDrops).toHaveBeenCalledWith('ckboss', [
        { difficulty: RAID_DIFFICULTIES.NORMAL, itemId: 249344 },
        { difficulty: RAID_DIFFICULTIES.HEROIC, itemId: 249344 },
        { difficulty: RAID_DIFFICULTIES.MYTHIC, itemId: 249344 },
      ]);
      expect(r.drops).toBe(3);
    });

    it('deixa o item sobrepor as dificuldades do boss', async () => {
      // O escape para peça exclusiva de mítico, que o produto cartesiano
      // superestimaria.
      const so_mitico = arquivo();
      so_mitico.bosses[0].items[0]!.difficulties = [RAID_DIFFICULTIES.MYTHIC];

      await service.carregarArquivo(so_mitico);

      expect(repo.replaceDrops).toHaveBeenCalledWith('ckboss', [
        { difficulty: RAID_DIFFICULTIES.MYTHIC, itemId: 249344 },
      ]);
    });

    it('para sem gravar nada quando o id do boss não bate no WCL', async () => {
      // O cenário que isto evita: id errado não quebra a carga, e o sintoma só
      // apareceria semanas depois como "a colagem não casa com boss nenhum".
      wcl.getRaidCatalog.mockResolvedValue(catalogoWcl('Outro Boss'));

      await expect(service.carregarArquivo(arquivo())).rejects.toThrow(/Outro Boss/);

      expect(repo.upsertRaid).not.toHaveBeenCalled();
      expect(repo.replaceDrops).not.toHaveBeenCalled();
    });

    it('aceita o id correto quando as fontes pontuam o nome diferente', async () => {
      // Caso real de 09/08/2026: o journal escreve "Chimaerus the Undreamt God" e
      // o WCL "Chimaerus, the Undreamt God". A vírgula reprovava um id CORRETO,
      // vindo do cliente do WoW — falso negativo que travava a carga inteira.
      const comVirgula = arquivo();
      comVirgula.bosses[0].name = 'Chimaerus the Undreamt God';
      wcl.getRaidCatalog.mockResolvedValue(catalogoWcl('Chimaerus, the Undreamt God'));

      await service.carregarArquivo(comVirgula);

      expect(repo.upsertRaid).toHaveBeenCalled();
    });

    it('para quando o WCL não conhece o id', async () => {
      wcl.getRaidCatalog.mockResolvedValue({
        encounters: new Map(),
        zones: new Map(),
        difficultyNames: new Map(),
      });

      await expect(service.carregarArquivo(arquivo())).rejects.toThrow(/não conhece/);
      expect(repo.upsertRaid).not.toHaveBeenCalled();
    });

    it('carrega sem consultar o WCL quando a conferência é desligada', async () => {
      // Saída de emergência para o WCL fora do ar.
      await service.carregarArquivo(arquivo(), { semConferencia: true });

      expect(wcl.getRaidCatalog).not.toHaveBeenCalled();
      expect(repo.upsertRaid).toHaveBeenCalled();
    });

    it('não consulta o WCL quando nenhum boss tem id', async () => {
      const semId = arquivo();
      delete semId.bosses[0].dungeonEncounterId;

      const r = await service.carregarArquivo(semId);

      expect(wcl.getRaidCatalog).not.toHaveBeenCalled();
      // E avisa, porque boss sem id não casa com a colagem do addon.
      expect(r.semDungeonEncounterId).toEqual(['Imperator Averzian']);
    });
  });

  it('traduz o enum de spec do banco para o slug do contrato', async () => {
    // O banco não aceita hífen em enum, então guarda `warrior_fury`. Se a
    // tradução vazar, o front recebe um valor que o schema do shared recusa.
    repo.findRaids.mockResolvedValue([
      raidRow({
        encounters: [
          {
            id: 'ckboss0',
            name: 'Boss A',
            position: 0,
            drops: [
              {
                difficulty: RaidDifficulty.mythic,
                item: itemRow(249276, {
                  primaryStats: [PRIMARY_STATS.STRENGTH],
                  specsCuratedAt: new Date('2026-08-09T00:00:00.000Z'),
                  usableBySpecs: [
                    { spec: WowSpec.warrior_fury },
                    { spec: WowSpec.paladin_protection },
                  ],
                }),
              },
            ],
          },
        ],
      }),
    ]);

    const raid = primeira(await service.listRaids());
    const drop = primeira(primeira(raid.encounters).drops);

    expect(drop.item.usableBySpecs).toEqual([SPECS.WARRIOR_FURY, SPECS.PALADIN_PROTECTION]);
    expect(drop.item.primaryStats).toEqual([PRIMARY_STATS.STRENGTH]);
    expect(drop.item.specsCuratedAt).toBe('2026-08-09T00:00:00.000Z');
  });

  it('não confunde "ninguém revisou" com "nenhuma spec usa"', async () => {
    // Item recém-cadastrado: lista vazia e carimbo nulo. Quem consome precisa
    // conseguir distinguir isso de um item revisado que de fato não serve a
    // ninguém — senão o cadastro novo aparece como inútil para todo mundo.
    repo.findRaids.mockResolvedValue([raidRow()]);

    const raid = primeira(await service.listRaids());
    const drop = primeira(primeira(raid.encounters).drops);

    expect(drop.item.usableBySpecs).toEqual([]);
    expect(drop.item.specsCuratedAt).toBeNull();
  });
});
