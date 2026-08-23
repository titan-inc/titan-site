import { ITEM_STATS_INDISPONIVEL, type BonusFacets, type WowItemDataFacets } from '@titan/shared';
import type { WowDataRepository } from './wow-data.repository';
import { WowItemStatsService } from './wow-item-stats.service';

function facetas(over: Partial<BonusFacets> & { bonusId: number }): BonusFacets {
  return {
    trackName: null,
    trackRank: null,
    trackMaxRank: null,
    trackScalingId: null,
    itemLevel: null,
    itemLevelMarcador: null,
    statIds: [],
    statAllocs: [],
    hasSocket: false,
    binding: null,
    difficulty: null,
    difficultyColor: null,
    quality: null,
    ...over,
  };
}

function item(over: Partial<WowItemDataFacets> = {}): WowItemDataFacets {
  return {
    itemLevel: 289,
    quality: 4,
    inventoryType: 6,
    material: 4,
    bonding: 1,
    flags: [0, 0],
    statIds: [4],
    statAllocs: [500],
    socketAllocs: [0],
    itemDelay: null,
    dmgVariance: null,
    flavor: null,
    itemSetId: null,
    budgetIndex: 1,
    scalingType: 'armor',
    armorModifier: null,
    effects: null,
    ...over,
  };
}

const escala = {
  itemLevel: 289,
  budget: [0, 1000, 0, 0],
  damageReplaceStat: 0,
  damageSecondary: 0,
  crMult: { armor: 1, weapon: 1, trinket: 1, jewelry: 1 },
  stamMult: { armor: 1, weapon: 1, trinket: 1, jewelry: 1 },
  socketCost: 0,
  armorTotal: [0, 0, 0, 50],
  armorQuality: [0, 0, 0, 0, 2],
  armorShield: [],
  dmgOneHand: [],
  dmgTwoHand: [],
  dmgOneHandCaster: [],
  dmgTwoHandCaster: [],
};

function montarRepo() {
  const repo = {
    buildAtivo: jest.fn<Promise<string | null>, []>(() => Promise.resolve('12.1.0.69299')),
    itemPorId: jest.fn<Promise<WowItemDataFacets | null>, [string, number]>(() =>
      Promise.resolve(item()),
    ),
    contextosDeBonus: jest.fn<Promise<number[]>, [string, number, number]>(() =>
      Promise.resolve([]),
    ),
    facetasDeBonus: jest.fn<Promise<BonusFacets[]>, [string, number[]]>(() => Promise.resolve([])),
    escalaPorItemLevel: jest.fn<Promise<typeof escala | null>, [string, number]>(() =>
      Promise.resolve(escala),
    ),
    setPorId: jest.fn(() => Promise.resolve(null)),
  };
  const service = new WowItemStatsService(repo as unknown as WowDataRepository);
  return { service, repo };
}

describe('WowItemStatsService.calcular', () => {
  it('itemString sem itemID é lacuna, sem tocar no repositório', async () => {
    const { service, repo } = montarRepo();

    const resultado = await service.calcular('não é um itemString');

    expect(resultado.indisponivel).toBe(ITEM_STATS_INDISPONIVEL.ITEM_STRING_INVALIDO);
    expect(repo.buildAtivo).not.toHaveBeenCalled();
  });

  it('sem build ativo, lacuna honesta, sem consultar item nenhum', async () => {
    const { service, repo } = montarRepo();
    repo.buildAtivo.mockResolvedValueOnce(null);

    const resultado = await service.calcular('item:249967::::::::90:250::35:0:');

    expect(resultado.indisponivel).toBe(ITEM_STATS_INDISPONIVEL.SEM_BUILD_ATIVO);
    expect(repo.itemPorId).not.toHaveBeenCalled();
  });

  it('item fora do build carregado é lacuna, não erro', async () => {
    const { service, repo } = montarRepo();
    repo.itemPorId.mockResolvedValueOnce(null);

    const resultado = await service.calcular('item:249967::::::::90:250::35:0:');

    expect(resultado.indisponivel).toBe(ITEM_STATS_INDISPONIVEL.ITEM_FORA_DO_BUILD);
  });

  it('une bonusIds explícitos com os da árvore, pelo itemContext do itemString', async () => {
    const { service, repo } = montarRepo();
    repo.contextosDeBonus.mockResolvedValueOnce([13440, 12806]);

    // itemContext 35, dois bonus explícitos: 6652 e 13534.
    await service.calcular('item:249967::::::::90:250::35:2:6652:13534:::::');

    expect(repo.contextosDeBonus).toHaveBeenCalledWith('12.1.0.69299', 249967, 35);
    expect(repo.facetasDeBonus).toHaveBeenCalledWith(
      '12.1.0.69299',
      expect.arrayContaining([6652, 13534, 13440, 12806]),
    );
  });

  /**
   * A ÁRVORE vem primeiro, o EXPLÍCITO por último — provado contra o banco
   * no `Bellamy's Final Judgement` (249277), ver o comentário de
   * `uniaoDeBonus`. `decodeBonuses` resolve empate de marcador igual pelo
   * ÚLTIMO da lista, então a ordem decide quem vence quando os dois
   * concordam em "confiável" e discordam no número.
   */
  it('a árvore entra ANTES dos explícitos na união — decide quem vence empate de marcador', async () => {
    const { service, repo } = montarRepo();
    repo.contextosDeBonus.mockResolvedValueOnce([12801]);

    await service.calcular('item:249277::::::::90:250::6:1:13654::::::');

    const [, bonusIds] = repo.facetasDeBonus.mock.calls[0]!;
    expect(bonusIds).toEqual([12801, 13654]); // árvore, depois explícito.
  });

  it('empate de marcador (0 e 0): o explícito do itemString vence a árvore, não o contrário', async () => {
    const { service, repo } = montarRepo();
    repo.contextosDeBonus.mockResolvedValueOnce([12801]);
    repo.facetasDeBonus.mockResolvedValueOnce([
      facetas({ bonusId: 12801, trackName: 'Myth', trackRank: 1, trackMaxRank: 6, itemLevel: 272 }),
      facetas({ bonusId: 13654, difficulty: 'Ascendant Voidforged: Myth', itemLevel: 298 }),
    ]);

    await service.calcular('item:249277::::::::90:250::6:1:13654::::::');

    expect(repo.escalaPorItemLevel).toHaveBeenCalledWith('12.1.0.69299', 298);
  });

  it('bonus repetido entre o itemString e a árvore não duplica na união', async () => {
    const { service, repo } = montarRepo();
    repo.contextosDeBonus.mockResolvedValueOnce([6652]); // mesmo id do explícito

    await service.calcular('item:249967::::::::90:250::35:1:6652::::::');

    const [, bonusIds] = repo.facetasDeBonus.mock.calls[0]!;
    expect(bonusIds).toEqual([6652]);
  });

  it('itemContext ausente no itemString não consulta a árvore', async () => {
    const { service, repo } = montarRepo();

    // Índice 12 (itemContext) vazio.
    await service.calcular('item:249967::::::::90:250:::0:');

    expect(repo.contextosDeBonus).not.toHaveBeenCalled();
  });

  it('resolve a escala pelo ilvl que os bônus determinam, não pelo base do item', async () => {
    const { service, repo } = montarRepo();
    repo.itemPorId.mockResolvedValueOnce(item({ itemLevel: 200 }));
    repo.facetasDeBonus.mockResolvedValueOnce([facetas({ bonusId: 1, itemLevel: 298 })]);

    await service.calcular('item:249967::::::::90:250::35:1:1::::::');

    expect(repo.escalaPorItemLevel).toHaveBeenCalledWith('12.1.0.69299', 298);
  });

  it('sem bonus de ilvl, cai pro itemLevel base do WowItemData', async () => {
    const { service, repo } = montarRepo();
    repo.itemPorId.mockResolvedValueOnce(item({ itemLevel: 276 }));

    await service.calcular('item:249967::::::::90:250::35:0:');

    expect(repo.escalaPorItemLevel).toHaveBeenCalledWith('12.1.0.69299', 276);
  });

  it('busca o conjunto só quando o item aponta pra um', async () => {
    const { service, repo } = montarRepo();

    repo.itemPorId.mockResolvedValueOnce(item({ itemSetId: null }));
    await service.calcular('item:249967::::::::90:250::35:0:');
    expect(repo.setPorId).not.toHaveBeenCalled();

    repo.itemPorId.mockResolvedValueOnce(item({ itemSetId: 1978 }));
    await service.calcular('item:249967::::::::90:250::35:0:');
    expect(repo.setPorId).toHaveBeenCalledWith('12.1.0.69299', 1978);
  });

  it('caminho feliz: devolve o payload calculado, sem indisponivel', async () => {
    const { service, repo } = montarRepo();
    repo.itemPorId.mockResolvedValueOnce(
      item({ statIds: [4], statAllocs: [500], socketAllocs: [0] }),
    );

    const resultado = await service.calcular('item:249967::::::::90:250::35:0:');

    expect(resultado.indisponivel).toBeNull();
    expect(resultado.primario).toEqual({ valor: 50, tipos: ['strength'] });
  });
});
