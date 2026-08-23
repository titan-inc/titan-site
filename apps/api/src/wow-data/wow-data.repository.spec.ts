import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { WowDataRepository } from './wow-data.repository';

type Chamada = Record<string, unknown>;

/**
 * Prisma dublado só com o que `regravarBuild`/`ativarBuild` tocam.
 *
 * `$transaction` aceita as DUAS formas que o Prisma expõe: a interativa
 * (`fn(tx)`, usada por `regravarBuild`) e a de array (usada por
 * `ativarBuild`) — a segunda só executa promises que já foram construídas
 * contra `prisma` direto, nunca contra `tx`.
 */
function montar(opts: { buildJaExiste?: boolean } = {}) {
  const chamadas = {
    findUniqueBuild: 0,
    upsertBuild: [] as Chamada[],
    deletes: [] as string[],
    createMany: {
      itens: [] as Chamada[][],
      bonuses: [] as Chamada[][],
      contextos: [] as Chamada[][],
      escalas: [] as Chamada[][],
      sets: [] as Chamada[][],
    },
    updateManyActive: [] as Chamada[],
    updateBuild: [] as Chamada[],
  };

  const modelosDeEscrita = {
    wowDataBuild: {
      findUnique: () => {
        chamadas.findUniqueBuild += 1;
        return Promise.resolve(opts.buildJaExiste ? { buildId: 'x' } : null);
      },
      upsert: (args: Chamada) => {
        chamadas.upsertBuild.push(args);
        return Promise.resolve({});
      },
      updateMany: (args: Chamada) => {
        chamadas.updateManyActive.push(args);
        return Promise.resolve({ count: 1 });
      },
      update: (args: Chamada) => {
        chamadas.updateBuild.push(args);
        return Promise.resolve({});
      },
    },
    wowItemData: {
      deleteMany: () => {
        chamadas.deletes.push('itens');
        return Promise.resolve({ count: 0 });
      },
      createMany: ({ data }: { data: Chamada[] }) => {
        chamadas.createMany.itens.push(data);
        return Promise.resolve({ count: data.length });
      },
    },
    wowBonus: {
      deleteMany: () => {
        chamadas.deletes.push('bonuses');
        return Promise.resolve({ count: 0 });
      },
      createMany: ({ data }: { data: Chamada[] }) => {
        chamadas.createMany.bonuses.push(data);
        return Promise.resolve({ count: data.length });
      },
    },
    wowItemContextBonus: {
      deleteMany: () => {
        chamadas.deletes.push('contextos');
        return Promise.resolve({ count: 0 });
      },
      createMany: ({ data }: { data: Chamada[] }) => {
        chamadas.createMany.contextos.push(data);
        return Promise.resolve({ count: data.length });
      },
    },
    wowItemLevelScaling: {
      deleteMany: () => {
        chamadas.deletes.push('escalas');
        return Promise.resolve({ count: 0 });
      },
      createMany: ({ data }: { data: Chamada[] }) => {
        chamadas.createMany.escalas.push(data);
        return Promise.resolve({ count: data.length });
      },
    },
    wowItemSet: {
      deleteMany: () => {
        chamadas.deletes.push('sets');
        return Promise.resolve({ count: 0 });
      },
      createMany: ({ data }: { data: Chamada[] }) => {
        chamadas.createMany.sets.push(data);
        return Promise.resolve({ count: data.length });
      },
    },
  };

  const prisma = {
    ...modelosDeEscrita,
    $transaction: (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof modelosDeEscrita) => Promise<unknown>)(modelosDeEscrita);
      }
      // Forma array — usada só por `ativarBuild`: as promises já foram
      // construídas contra `prisma` direto antes de chegar aqui.
      return Promise.all(arg as Promise<unknown>[]);
    },
  } as unknown as PrismaService;

  return { repo: new WowDataRepository(prisma), chamadas };
}

function linha<T extends string>(cols: readonly T[], valores: unknown[]): Record<T, unknown> {
  const obj = {} as Record<T, unknown>;
  cols.forEach((c, i) => (obj[c] = valores[i]));
  return obj;
}

const COLS_ITEM_TESTE = [
  'itemId',
  'itemLevel',
  'quality',
  'inventoryType',
  'material',
  'bonding',
  'flags',
  'statIds',
  'statAllocs',
  'socketAllocs',
  'itemDelay',
  'dmgVariance',
  'flavor',
  'nameDescriptionId',
  'itemSetId',
  'budgetIndex',
  'scalingType',
  'armorModifier',
  'effects',
] as const;

describe('WowDataRepository.regravarBuild', () => {
  it('nunca escreve `active` — carregar não é ativar', async () => {
    const { repo, chamadas } = montar();

    await repo.regravarBuild('12.1.0.69299', {
      itens: [],
      bonuses: [],
      contextos: [],
      escalas: [],
      sets: [],
    });

    const args = chamadas.upsertBuild[0];
    expect(args).toBeDefined();
    expect((args?.create as Chamada)['active']).toBeUndefined();
    expect(args?.update).toEqual({});
  });

  it('apaga as quatro tabelas do build antes de regravar — recarregar não faz merge', async () => {
    const { repo, chamadas } = montar();

    await repo.regravarBuild('12.1.0.69299', {
      itens: [linha(COLS_ITEM_TESTE, [1])],
      bonuses: [],
      contextos: [],
      escalas: [],
      sets: [],
    });

    expect(chamadas.deletes).toEqual(['itens', 'bonuses', 'contextos', 'escalas', 'sets']);
  });

  it('`novo` é true quando o build ainda não existia, false quando já existia', async () => {
    const { repo: repoNovo } = montar({ buildJaExiste: false });
    const { repo: repoExistente } = montar({ buildJaExiste: true });

    const a = await repoNovo.regravarBuild('b1', {
      itens: [],
      bonuses: [],
      contextos: [],
      escalas: [],
      sets: [],
    });
    const b = await repoExistente.regravarBuild('b1', {
      itens: [],
      bonuses: [],
      contextos: [],
      escalas: [],
      sets: [],
    });

    expect(a.novo).toBe(true);
    expect(b.novo).toBe(false);
  });

  it('grava `contextos` em lotes — 3 colunas + buildId = 4 parâmetros por linha, limite de 65.535', async () => {
    const { repo, chamadas } = montar();
    const totalDeLinhas = 16_383 * 2 + 5; // força 3 lotes (16383, 16383, 5)
    const contextos = Array.from({ length: totalDeLinhas }, (_, i) => ({
      itemId: i,
      itemContext: 1,
      bonusId: 2,
    }));

    await repo.regravarBuild('12.1.0.69299', {
      itens: [],
      bonuses: [],
      contextos,
      escalas: [],
      sets: [],
    });

    expect(chamadas.createMany.contextos).toHaveLength(3);
    expect(chamadas.createMany.contextos.map((l) => l.length)).toEqual([16_383, 16_383, 5]);
    // Todo lote injeta o buildId — a coluna não vem no objeto de origem.
    expect(chamadas.createMany.contextos[0]?.[0]).toMatchObject({
      buildId: '12.1.0.69299',
      itemId: 0,
    });
  });

  it('mapeia a linha de item pro shape do Prisma, incluindo o `null` de JSON', async () => {
    const { repo, chamadas } = montar();

    await repo.regravarBuild('12.1.0.69299', {
      itens: [
        linha(COLS_ITEM_TESTE, [
          205145,
          1,
          3,
          0,
          4,
          0,
          [64, 24576],
          [-1, -1],
          [0, 0],
          [0, 0],
          null,
          0,
          'flavor',
          null,
          null, // itemSetId
          0,
          'armor',
          null,
          null,
        ]),
      ],
      bonuses: [],
      contextos: [],
      escalas: [],
      sets: [],
    });

    const gravado = chamadas.createMany.itens[0]?.[0];
    expect(gravado).toMatchObject({
      buildId: '12.1.0.69299',
      itemId: 205145,
      scalingType: 'armor',
      itemDelay: null,
      effects: Prisma.JsonNull,
    });
  });
});

describe('WowDataRepository.ativarBuild', () => {
  it('desativa o ativo anterior e ativa o novo NA MESMA transação (array, não callback)', async () => {
    const { repo, chamadas } = montar();

    await repo.ativarBuild('12.1.0.69299');

    expect(chamadas.updateManyActive).toEqual([
      { where: { active: true }, data: { active: false } },
    ]);
    expect(chamadas.updateBuild).toEqual([
      { where: { buildId: '12.1.0.69299' }, data: { active: true } },
    ]);
  });
});

describe('WowDataRepository.buildExiste', () => {
  it('true quando a linha existe, false quando não', async () => {
    const { repo: comBuild } = montar({ buildJaExiste: true });
    const { repo: semBuild } = montar({ buildJaExiste: false });

    expect(await comBuild.buildExiste('x')).toBe(true);
    expect(await semBuild.buildExiste('x')).toBe(false);
  });
});

/**
 * Os quatro métodos de leitura por item — TIT-136. Mock ENXUTO, só com o
 * `findUnique`/`findMany` que cada teste toca; nada aqui reaproveita
 * `montar()` porque aquele mock é do caminho de ESCRITA (`regravarBuild`).
 */
function montarLeitura() {
  const prisma = {
    wowItemContextBonus: { findMany: jest.fn() },
    wowItemData: { findUnique: jest.fn(), findMany: jest.fn() },
    wowItemLevelScaling: { findUnique: jest.fn(), findMany: jest.fn() },
    wowItemSet: { findUnique: jest.fn(), findMany: jest.fn() },
    wowBonus: { aggregate: jest.fn() },
  };
  return { repo: new WowDataRepository(prisma as unknown as PrismaService), prisma };
}

describe('WowDataRepository.contextosDeBonus', () => {
  it('devolve só os bonusId — a árvore já resolvida pelo gerador', async () => {
    const { repo, prisma } = montarLeitura();
    prisma.wowItemContextBonus.findMany.mockResolvedValue([{ bonusId: 1 }, { bonusId: 2 }]);

    const ids = await repo.contextosDeBonus('b1', 249967, 6);

    expect(ids).toEqual([1, 2]);
    expect(prisma.wowItemContextBonus.findMany).toHaveBeenCalledWith({
      where: { buildId: 'b1', itemId: 249967, itemContext: 6 },
      select: { bonusId: true },
    });
  });
});

describe('WowDataRepository.itemPorId', () => {
  const linhaBase = {
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
  };

  it('null quando o item não tem dado neste build — lacuna, não erro', async () => {
    const { repo, prisma } = montarLeitura();
    prisma.wowItemData.findUnique.mockResolvedValue(null);

    expect(await repo.itemPorId('b1', 999)).toBeNull();
  });

  it('effects nulo na coluna passa direto', async () => {
    const { repo, prisma } = montarLeitura();
    prisma.wowItemData.findUnique.mockResolvedValue(linhaBase);

    const item = await repo.itemPorId('b1', 249967);

    expect(item?.effects).toBeNull();
    expect(prisma.wowItemData.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { buildId_itemId: { buildId: 'b1', itemId: 249967 } } }),
    );
  });

  it('effects presente e válido é devolvido estruturado', async () => {
    const { repo, prisma } = montarLeitura();
    const effects = {
      spellId: 1,
      descricaoTemplate: 'Ganha $s1.',
      duracaoMs: null,
      maxStacks: null,
      efeitos: [],
    };
    prisma.wowItemData.findUnique.mockResolvedValue({ ...linhaBase, effects });

    expect((await repo.itemPorId('b1', 249967))?.effects).toEqual(effects);
  });

  it('effects malformado vira null — rede de segurança, não trava o resto do item', async () => {
    const { repo, prisma } = montarLeitura();
    prisma.wowItemData.findUnique.mockResolvedValue({
      ...linhaBase,
      effects: { campoQueNaoExiste: true },
    });

    expect((await repo.itemPorId('b1', 249967))?.effects).toBeNull();
  });
});

describe('WowDataRepository.escalaPorItemLevel', () => {
  it('null quando o ilvl não tem linha — lacuna, nunca zero', async () => {
    const { repo, prisma } = montarLeitura();
    prisma.wowItemLevelScaling.findUnique.mockResolvedValue(null);

    expect(await repo.escalaPorItemLevel('b1', 9999)).toBeNull();
  });

  it('crMult/stamMult voltam de Float[4] pra {armor,weapon,trinket,jewelry}', async () => {
    const { repo, prisma } = montarLeitura();
    prisma.wowItemLevelScaling.findUnique.mockResolvedValue({
      itemLevel: 289,
      budget: [1, 2, 3, 4],
      damageReplaceStat: 0,
      damageSecondary: 0,
      crMult: [1, 2, 3, 4],
      stamMult: [5, 6, 7, 8],
      socketCost: 0,
      armorTotal: [],
      armorQuality: [],
      armorShield: [],
      dmgOneHand: [],
      dmgTwoHand: [],
      dmgOneHandCaster: [],
      dmgTwoHandCaster: [],
    });

    const escala = await repo.escalaPorItemLevel('b1', 289);

    expect(escala?.crMult).toEqual({ armor: 1, weapon: 2, trinket: 3, jewelry: 4 });
    expect(escala?.stamMult).toEqual({ armor: 5, weapon: 6, trinket: 7, jewelry: 8 });
  });
});

describe('WowDataRepository.setPorId', () => {
  it('null quando o conjunto referenciado não tem linha neste build', async () => {
    const { repo, prisma } = montarLeitura();
    prisma.wowItemSet.findUnique.mockResolvedValue(null);

    expect(await repo.setPorId('b1', 1978)).toBeNull();
  });

  it('bonuses válido é devolvido estruturado', async () => {
    const { repo, prisma } = montarLeitura();
    prisma.wowItemSet.findUnique.mockResolvedValue({
      itemSetId: 1978,
      name: "Relentless Rider's Lament",
      pieceItemIds: [1, 2, 3, 4, 5],
      bonuses: [{ chrSpecId: 250, threshold: 2, spellId: 999 }],
    });

    const set = await repo.setPorId('b1', 1978);

    expect(set?.bonuses).toEqual([{ chrSpecId: 250, threshold: 2, spellId: 999 }]);
  });

  it('bonuses malformado vira lista vazia — o conjunto não perde nome nem contagem por isso', async () => {
    const { repo, prisma } = montarLeitura();
    prisma.wowItemSet.findUnique.mockResolvedValue({
      itemSetId: 1978,
      name: "Relentless Rider's Lament",
      pieceItemIds: [1, 2, 3, 4, 5],
      bonuses: 'isto não é um array de bônus',
    });

    const set = await repo.setPorId('b1', 1978);

    expect(set?.bonuses).toEqual([]);
    expect(set?.name).toBe("Relentless Rider's Lament"); // o resto do conjunto sobrevive.
  });
});

/**
 * Os métodos plurais — TIT-135. Mesma régua do lado singular: `Map` vazio
 * sem consultar o banco quando a entrada é vazia, e a chave do `Map` é
 * quem chama despareia depois.
 */
describe('WowDataRepository.itensPorId', () => {
  it('Map vazio sem consultar quando não há itemId', async () => {
    const { repo, prisma } = montarLeitura();

    const itens = await repo.itensPorId('b1', []);

    expect(itens.size).toBe(0);
    expect(prisma.wowItemData.findMany).not.toHaveBeenCalled();
  });

  it('despareia pelo itemId, sem o campo vazar pro `WowItemDataFacets`', async () => {
    const { repo, prisma } = montarLeitura();
    prisma.wowItemData.findMany.mockResolvedValue([
      { itemId: 249967, itemLevel: 289, effects: null },
      { itemId: 249277, itemLevel: 298, effects: null },
    ]);

    const itens = await repo.itensPorId('b1', [249967, 249277]);

    expect(itens.size).toBe(2);
    expect(itens.get(249967)).toMatchObject({ itemLevel: 289 });
    expect((itens.get(249967) as { itemId?: number }).itemId).toBeUndefined();
    expect(prisma.wowItemData.findMany).toHaveBeenCalledWith({
      where: { buildId: 'b1', itemId: { in: [249967, 249277] } },
      select: expect.objectContaining({ itemId: true }),
    });
  });
});

describe('WowDataRepository.contextosDeBonusDeVarios', () => {
  it('Map vazio sem consultar quando não há par nenhum', async () => {
    const { repo, prisma } = montarLeitura();

    const contextos = await repo.contextosDeBonusDeVarios('b1', []);

    expect(contextos.size).toBe(0);
    expect(prisma.wowItemContextBonus.findMany).not.toHaveBeenCalled();
  });

  it('agrupa por `itemId:itemContext`, sem repetir par no OR', async () => {
    const { repo, prisma } = montarLeitura();
    prisma.wowItemContextBonus.findMany.mockResolvedValue([
      { itemId: 249967, itemContext: 6, bonusId: 1 },
      { itemId: 249967, itemContext: 6, bonusId: 2 },
      { itemId: 249277, itemContext: 6, bonusId: 3 },
    ]);

    const contextos = await repo.contextosDeBonusDeVarios('b1', [
      { itemId: 249967, itemContext: 6 },
      { itemId: 249967, itemContext: 6 }, // repetido — mesma peça, duas linhas
      { itemId: 249277, itemContext: 6 },
    ]);

    expect(contextos.get('249967:6')).toEqual([1, 2]);
    expect(contextos.get('249277:6')).toEqual([3]);
    expect(prisma.wowItemContextBonus.findMany).toHaveBeenCalledWith({
      where: {
        buildId: 'b1',
        OR: [
          { itemId: 249967, itemContext: 6 },
          { itemId: 249277, itemContext: 6 },
        ],
      },
      select: { itemId: true, itemContext: true, bonusId: true },
    });
  });
});

describe('WowDataRepository.escalasPorItemLevel', () => {
  it('Map vazio sem consultar quando não há itemLevel', async () => {
    const { repo, prisma } = montarLeitura();

    const escalas = await repo.escalasPorItemLevel('b1', []);

    expect(escalas.size).toBe(0);
    expect(prisma.wowItemLevelScaling.findMany).not.toHaveBeenCalled();
  });

  it('despareia pelo itemLevel, crMult/stamMult convertidos como no singular', async () => {
    const { repo, prisma } = montarLeitura();
    prisma.wowItemLevelScaling.findMany.mockResolvedValue([
      {
        itemLevel: 289,
        budget: [],
        damageReplaceStat: 0,
        damageSecondary: 0,
        crMult: [1, 2, 3, 4],
        stamMult: [5, 6, 7, 8],
        socketCost: 0,
        armorTotal: [],
        armorQuality: [],
        armorShield: [],
        dmgOneHand: [],
        dmgTwoHand: [],
        dmgOneHandCaster: [],
        dmgTwoHandCaster: [],
      },
    ]);

    const escalas = await repo.escalasPorItemLevel('b1', [289]);

    expect(escalas.get(289)?.crMult).toEqual({ armor: 1, weapon: 2, trinket: 3, jewelry: 4 });
  });
});

describe('WowDataRepository.setsPorId', () => {
  it('Map vazio sem consultar quando não há itemSetId', async () => {
    const { repo, prisma } = montarLeitura();

    const sets = await repo.setsPorId('b1', []);

    expect(sets.size).toBe(0);
    expect(prisma.wowItemSet.findMany).not.toHaveBeenCalled();
  });

  it('despareia pelo itemSetId, bonuses malformado ainda vira lista vazia', async () => {
    const { repo, prisma } = montarLeitura();
    prisma.wowItemSet.findMany.mockResolvedValue([
      { itemSetId: 1978, name: 'Set A', pieceItemIds: [1, 2], bonuses: [] },
      { itemSetId: 1979, name: 'Set B', pieceItemIds: [3, 4], bonuses: 'malformado' },
    ]);

    const sets = await repo.setsPorId('b1', [1978, 1979]);

    expect(sets.get(1978)?.name).toBe('Set A');
    expect(sets.get(1979)?.bonuses).toEqual([]);
  });
});

describe('WowDataRepository.trackScalingIdAtual', () => {
  it('devolve o MAX(trackScalingId) do build', async () => {
    const { repo, prisma } = montarLeitura();
    prisma.wowBonus.aggregate.mockResolvedValue({ _max: { trackScalingId: 12 } });

    expect(await repo.trackScalingIdAtual('b1')).toBe(12);
    expect(prisma.wowBonus.aggregate).toHaveBeenCalledWith({
      where: { buildId: 'b1' },
      _max: { trackScalingId: true },
    });
  });

  it('null quando o build não tem bonus com track nenhum', async () => {
    const { repo, prisma } = montarLeitura();
    prisma.wowBonus.aggregate.mockResolvedValue({ _max: { trackScalingId: null } });

    expect(await repo.trackScalingIdAtual('b1')).toBeNull();
  });
});
