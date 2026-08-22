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
    });

    expect(chamadas.deletes).toEqual(['itens', 'bonuses', 'contextos', 'escalas']);
  });

  it('`novo` é true quando o build ainda não existia, false quando já existia', async () => {
    const { repo: repoNovo } = montar({ buildJaExiste: false });
    const { repo: repoExistente } = montar({ buildJaExiste: true });

    const a = await repoNovo.regravarBuild('b1', {
      itens: [],
      bonuses: [],
      contextos: [],
      escalas: [],
    });
    const b = await repoExistente.regravarBuild('b1', {
      itens: [],
      bonuses: [],
      contextos: [],
      escalas: [],
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

    await repo.regravarBuild('12.1.0.69299', { itens: [], bonuses: [], contextos, escalas: [] });

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
          0,
          'armor',
          null,
          null,
        ]),
      ],
      bonuses: [],
      contextos: [],
      escalas: [],
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
