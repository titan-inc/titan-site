import {
  ITEM_STATS_INDISPONIVEL,
  type BonusFacets,
  type LinhaEscala,
  type WowItemDataFacets,
  type WowItemSetFacets,
} from '@titan/shared';
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

const escala: LinhaEscala = {
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

/**
 * O mock do repositório fala em PLURAL — TIT-135. Os defaults respondem
 * genericamente ao que foi pedido (`itemIds.map(...)`, `itemLevels.map(...)`)
 * pra não precisar de `mockResolvedValueOnce` em todo teste que só quer o
 * caminho feliz com um item qualquer.
 */
function montarRepo() {
  const repo = {
    buildAtivo: jest.fn<Promise<string | null>, []>(() => Promise.resolve('12.1.0.69299')),
    itensPorId: jest.fn<Promise<Map<number, WowItemDataFacets>>, [string, number[]]>(
      (_buildId, itemIds) => Promise.resolve(new Map(itemIds.map((id) => [id, item()]))),
    ),
    contextosDeBonusDeVarios: jest.fn<
      Promise<Map<string, number[]>>,
      [string, Array<{ itemId: number; itemContext: number }>]
    >(() => Promise.resolve(new Map())),
    facetasDeBonus: jest.fn<Promise<BonusFacets[]>, [string, number[]]>(() => Promise.resolve([])),
    escalasPorItemLevel: jest.fn<Promise<Map<number, LinhaEscala>>, [string, number[]]>(
      (_buildId, itemLevels) => Promise.resolve(new Map(itemLevels.map((l) => [l, escala]))),
    ),
    setsPorId: jest.fn<Promise<Map<number, WowItemSetFacets>>, [string, number[]]>(() =>
      Promise.resolve(new Map()),
    ),
    trackScalingIdAtual: jest.fn<Promise<number | null>, [string]>(() => Promise.resolve(12)),
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
    expect(repo.itensPorId).not.toHaveBeenCalled();
  });

  it('sem build ativo, os bonusIds explícitos aparecem em desconhecidos — mesma régua do decodificar', async () => {
    const { service, repo } = montarRepo();
    repo.buildAtivo.mockResolvedValueOnce(null);

    const resultado = await service.calcular('item:249967::::::::90:250::35:2:6652:13534:::::');

    expect(resultado.desconhecidos).toEqual([6652, 13534]);
    expect(resultado.track).toBeNull();
    expect(resultado.sockets).toBe(0);
  });

  it('item fora do build carregado é lacuna, não erro', async () => {
    const { service, repo } = montarRepo();
    repo.itensPorId.mockResolvedValueOnce(new Map()); // itemId pedido, sem linha.

    const resultado = await service.calcular('item:249967::::::::90:250::35:0:');

    expect(resultado.indisponivel).toBe(ITEM_STATS_INDISPONIVEL.ITEM_FORA_DO_BUILD);
  });

  it('une bonusIds explícitos com os da árvore, pelo itemContext do itemString', async () => {
    const { service, repo } = montarRepo();
    repo.contextosDeBonusDeVarios.mockResolvedValueOnce(
      new Map([['249967:35', [13440, 12806]]]),
    );

    // itemContext 35, dois bonus explícitos: 6652 e 13534.
    await service.calcular('item:249967::::::::90:250::35:2:6652:13534:::::');

    expect(repo.contextosDeBonusDeVarios).toHaveBeenCalledWith('12.1.0.69299', [
      { itemId: 249967, itemContext: 35 },
    ]);
    expect(repo.facetasDeBonus).toHaveBeenCalledWith(
      '12.1.0.69299',
      expect.arrayContaining([6652, 13534, 13440, 12806]),
    );
  });

  /**
   * A ÁRVORE vem primeiro, o EXPLÍCITO por último — provado contra o banco
   * no `Bellamy's Final Judgement` (249277), ver o comentário de
   * `decodificarOnda1`. `decodeBonuses` resolve empate de marcador igual pelo
   * ÚLTIMO da lista, então a ordem decide quem vence quando os dois
   * concordam em "confiável" e discordam no número.
   */
  it('a árvore entra ANTES dos explícitos na união — decide quem vence empate de marcador', async () => {
    const { service, repo } = montarRepo();
    repo.contextosDeBonusDeVarios.mockResolvedValueOnce(new Map([['249277:6', [12801]]]));

    await service.calcular('item:249277::::::::90:250::6:1:13654::::::');

    const [, bonusIds] = repo.facetasDeBonus.mock.calls[0]!;
    expect(bonusIds).toEqual([12801, 13654]); // árvore, depois explícito.
  });

  it('empate de marcador (0 e 0): o explícito do itemString vence a árvore, não o contrário', async () => {
    const { service, repo } = montarRepo();
    repo.contextosDeBonusDeVarios.mockResolvedValueOnce(new Map([['249277:6', [12801]]]));
    repo.facetasDeBonus.mockResolvedValueOnce([
      facetas({ bonusId: 12801, trackName: 'Myth', trackRank: 1, trackMaxRank: 6, itemLevel: 272 }),
      facetas({ bonusId: 13654, difficulty: 'Ascendant Voidforged: Myth', itemLevel: 298 }),
    ]);

    await service.calcular('item:249277::::::::90:250::6:1:13654::::::');

    expect(repo.escalasPorItemLevel).toHaveBeenCalledWith('12.1.0.69299', [298]);
  });

  it('bonus repetido entre o itemString e a árvore não duplica na união', async () => {
    const { service, repo } = montarRepo();
    repo.contextosDeBonusDeVarios.mockResolvedValueOnce(new Map([['249967:35', [6652]]])); // mesmo id do explícito

    await service.calcular('item:249967::::::::90:250::35:1:6652::::::');

    const [, bonusIds] = repo.facetasDeBonus.mock.calls[0]!;
    expect(bonusIds).toEqual([6652]);
  });

  it('itemContext ausente no itemString não consulta a árvore', async () => {
    const { service, repo } = montarRepo();

    // Índice 12 (itemContext) vazio.
    await service.calcular('item:249967::::::::90:250:::0:');

    expect(repo.contextosDeBonusDeVarios).not.toHaveBeenCalled();
  });

  it('resolve a escala pelo ilvl que os bônus determinam, não pelo base do item', async () => {
    const { service, repo } = montarRepo();
    repo.itensPorId.mockResolvedValueOnce(new Map([[249967, item({ itemLevel: 200 })]]));
    repo.facetasDeBonus.mockResolvedValueOnce([facetas({ bonusId: 1, itemLevel: 298 })]);

    await service.calcular('item:249967::::::::90:250::35:1:1::::::');

    expect(repo.escalasPorItemLevel).toHaveBeenCalledWith('12.1.0.69299', [298]);
  });

  it('sem bonus de ilvl, cai pro itemLevel base do WowItemData', async () => {
    const { service, repo } = montarRepo();
    repo.itensPorId.mockResolvedValueOnce(new Map([[249967, item({ itemLevel: 276 })]]));

    await service.calcular('item:249967::::::::90:250::35:0:');

    expect(repo.escalasPorItemLevel).toHaveBeenCalledWith('12.1.0.69299', [276]);
  });

  it('busca o conjunto só quando o item aponta pra um', async () => {
    const { service, repo } = montarRepo();

    repo.itensPorId.mockResolvedValueOnce(new Map([[249967, item({ itemSetId: null })]]));
    await service.calcular('item:249967::::::::90:250::35:0:');
    expect(repo.setsPorId).not.toHaveBeenCalled();

    repo.itensPorId.mockResolvedValueOnce(new Map([[249967, item({ itemSetId: 1978 })]]));
    await service.calcular('item:249967::::::::90:250::35:0:');
    expect(repo.setsPorId).toHaveBeenCalledWith('12.1.0.69299', [1978]);
  });

  it('caminho feliz: devolve o payload calculado, sem indisponivel', async () => {
    const { service, repo } = montarRepo();
    repo.itensPorId.mockResolvedValueOnce(
      new Map([[249967, item({ statIds: [4], statAllocs: [500], socketAllocs: [0] })]]),
    );

    const resultado = await service.calcular('item:249967::::::::90:250::35:0:');

    expect(resultado.indisponivel).toBeNull();
    expect(resultado.primario).toEqual({ valor: 50, tipos: ['strength'] });
  });

  it('caminho feliz: track/dificuldade/sockets/desconhecidos chegam sem a TIT-135 refazer a união', async () => {
    const { service, repo } = montarRepo();
    repo.facetasDeBonus.mockResolvedValueOnce([
      facetas({
        bonusId: 12806,
        trackName: 'Myth',
        trackRank: 4,
        trackMaxRank: 6,
        trackScalingId: 12,
        difficulty: 'Mythic',
        hasSocket: true,
      }),
    ]);

    const resultado = await service.calcular('item:249967::::::::90:250::35:2:12806:999999:::::');

    expect(resultado.track).toEqual({ nome: 'Myth', rank: 4, de: 6, scalingId: 12 });
    expect(resultado.dificuldade).toBe('Mythic');
    expect(resultado.sockets).toBe(1);
    expect(resultado.desconhecidos).toEqual([999999]); // não estava no mock de facetasDeBonus.
  });
});

describe('WowItemStatsService.calcularVarios', () => {
  it('Map vazio para lista vazia, sem tocar no repositório', async () => {
    const { service, repo } = montarRepo();

    const resultado = await service.calcularVarios([]);

    expect(resultado.size).toBe(0);
    expect(repo.buildAtivo).not.toHaveBeenCalled();
  });

  it('itemString repetido calcula uma vez só — o Map de saída responde pelas duas entradas', async () => {
    const { service, repo } = montarRepo();
    const itemString = 'item:249967::::::::90:250::35:0:';

    const resultado = await service.calcularVarios([itemString, itemString]);

    expect(resultado.size).toBe(1);
    expect(repo.itensPorId).toHaveBeenCalledTimes(1);
  });

  it('duas peças com o mesmo itemId e itemString diferente saem com resultados diferentes', async () => {
    const { service, repo } = montarRepo();
    repo.facetasDeBonus.mockImplementation((_buildId, bonusIds) =>
      Promise.resolve(
        bonusIds.includes(12806)
          ? [facetas({ bonusId: 12806, trackName: 'Myth', trackRank: 4, trackMaxRank: 6 })]
          : [],
      ),
    );

    const semTrack = 'item:249967::::::::90:250::35:0:';
    const comTrack = 'item:249967::::::::90:250::35:1:12806::::::';

    const resultado = await service.calcularVarios([semTrack, comTrack]);

    expect(resultado.get(semTrack)?.track).toBeNull();
    expect(resultado.get(comTrack)?.track).toMatchObject({ nome: 'Myth', rank: 4, de: 6 });
  });

  it('N itens distintos: cada método plural é chamado UMA vez, não uma por item — duas ondas', async () => {
    const { service, repo } = montarRepo();
    repo.itensPorId.mockResolvedValueOnce(
      new Map([
        [249967, item({ itemLevel: 289 })],
        [249277, item({ itemLevel: 298 })],
        [268262, item({ itemLevel: 305 })],
      ]),
    );

    await service.calcularVarios([
      'item:249967::::::::90:250::35:0:',
      'item:249277::::::::90:250::6:0:',
      'item:268262::::::::90:250::5:0:',
    ]);

    expect(repo.buildAtivo).toHaveBeenCalledTimes(1);
    expect(repo.itensPorId).toHaveBeenCalledTimes(1);
    expect(repo.contextosDeBonusDeVarios).toHaveBeenCalledTimes(1);
    expect(repo.facetasDeBonus).toHaveBeenCalledTimes(1);
    expect(repo.escalasPorItemLevel).toHaveBeenCalledTimes(1);
    expect(repo.escalasPorItemLevel).toHaveBeenCalledWith(
      '12.1.0.69299',
      expect.arrayContaining([289, 298, 305]),
    );
  });

  it('item fora do build não trava os outros itens do lote', async () => {
    const { service, repo } = montarRepo();
    repo.itensPorId.mockResolvedValueOnce(new Map([[249967, item()]])); // 249277 fica de fora.

    const resultado = await service.calcularVarios([
      'item:249967::::::::90:250::35:0:',
      'item:249277::::::::90:250::6:0:',
    ]);

    expect(resultado.get('item:249967::::::::90:250::35:0:')?.indisponivel).toBeNull();
    expect(resultado.get('item:249277::::::::90:250::6:0:')?.indisponivel).toBe(
      ITEM_STATS_INDISPONIVEL.ITEM_FORA_DO_BUILD,
    );
  });
});

describe('WowItemStatsService.trackScalingIdAtual', () => {
  it('delega pro repositório, resolvendo o build ativo primeiro', async () => {
    const { service, repo } = montarRepo();
    repo.trackScalingIdAtual.mockResolvedValueOnce(12);

    expect(await service.trackScalingIdAtual()).toBe(12);
    expect(repo.trackScalingIdAtual).toHaveBeenCalledWith('12.1.0.69299');
  });

  it('null sem build ativo, sem tocar o repositório', async () => {
    const { service, repo } = montarRepo();
    repo.buildAtivo.mockResolvedValueOnce(null);

    expect(await service.trackScalingIdAtual()).toBeNull();
    expect(repo.trackScalingIdAtual).not.toHaveBeenCalled();
  });
});
