import type { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

const item = (itemId: number) => ({
  itemId,
  name: null,
  icon: null,
  equipLoc: null,
  itemSubclass: null,
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
        { difficulty: 'mythic' as const, item: item(249276) },
        { difficulty: 'heroic' as const, item: item(249276) },
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
});
