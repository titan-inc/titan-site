import type { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

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
  encounters: [
    {
      id: 'ckboss0',
      name: 'Boss A',
      position: 0,
      drops: [
        { difficulty: 'mythic' as const, item: itemRow(249276) },
        { difficulty: 'heroic' as const, item: itemRow(249276) },
      ],
    },
    {
      id: 'ckboss1',
      name: 'Boss B',
      position: 1,
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

describe('CatalogService', () => {
  const repo = { findRaids: jest.fn(), findRaidBySlug: jest.fn() };
  let service: CatalogService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new CatalogService(repo as unknown as CatalogRepository);
  });

  it('traduz a raid para o contrato do shared', async () => {
    repo.findRaids.mockResolvedValue([raidRow()]);

    const raid = primeira(await service.listRaids());

    expect(raid).toMatchObject({ slug: 'the-voidspire', seasonId: null });
    expect(raid.encounters.map((e) => e.drops)).toEqual([
      [
        { difficulty: 'mythic', item: item(249276) },
        { difficulty: 'heroic', item: item(249276) },
      ],
      [],
    ]);
  });

  it('mantém o boss que não tem drop na dificuldade filtrada', async () => {
    // Lista vazia é a resposta certa para "o que este boss solta no mítico?"
    // quando ainda não cadastraram nada. Sumir com o boss faria parecer que ele
    // não existe na raid.
    repo.findRaids.mockResolvedValue([raidRow()]);

    const raid = primeira(await service.listRaids({ difficulty: 'mythic' }));

    expect(raid.encounters.map((e) => e.name)).toEqual(['Boss A', 'Boss B']);
    expect(raid.encounters.map((e) => e.drops.length)).toEqual([2, 0]);
  });

  it('repassa o filtro para o repository em vez de filtrar em memória', async () => {
    repo.findRaids.mockResolvedValue([]);

    await service.listRaids({ seasonId: 17, difficulty: 'heroic' });

    expect(repo.findRaids).toHaveBeenCalledWith({ seasonId: 17, difficulty: 'heroic' });
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
                difficulty: 'mythic' as const,
                item: itemRow(249276, {
                  primaryStats: ['strength'],
                  specsCuratedAt: new Date('2026-08-09T00:00:00.000Z'),
                  usableBySpecs: [{ spec: 'warrior_fury' }, { spec: 'paladin_protection' }],
                }),
              },
            ],
          },
        ],
      }),
    ]);

    const raid = primeira(await service.listRaids());
    const drop = primeira(primeira(raid.encounters).drops);

    expect(drop.item.usableBySpecs).toEqual(['warrior-fury', 'paladin-protection']);
    expect(drop.item.primaryStats).toEqual(['strength']);
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
