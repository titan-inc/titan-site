import { SPECS } from '@titan/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { LootCatalogRepository } from './loot-catalog.repository';

/**
 * Prisma dublado só com o que `upsertItem` toca.
 *
 * O que interessa aqui não é o SQL, é **se** a atualização de `specsCuratedAt`
 * entra na transação. Essa decisão é o que separa "a máquina propôs" de "um
 * humano assinou", e nenhum outro teste alcança: o spec do service usa
 * repositório dublado, então a regra passaria despercebida.
 */
function montar(specsCuratedAt: Date | null) {
  const chamadas = {
    upsert: 0,
    deleteMany: 0,
    createMany: [] as unknown[],
    updates: [] as Record<string, unknown>[],
    transacoes: 0,
  };

  const prisma = {
    wowItem: {
      upsert: () => {
        chamadas.upsert += 1;
        return Promise.resolve({});
      },
      findUnique: () => Promise.resolve({ specsCuratedAt }),
      update: ({ data }: { data: Record<string, unknown> }) => {
        chamadas.updates.push(data);
        return { __update: data };
      },
    },
    wowItemSpec: {
      deleteMany: () => {
        chamadas.deleteMany += 1;
        return { __delete: true };
      },
      createMany: ({ data }: { data: unknown }) => {
        chamadas.createMany.push(data);
        return { __create: data };
      },
    },
    // As operações são montadas antes de entrar aqui, então basta contar.
    $transaction: () => {
      chamadas.transacoes += 1;
      return Promise.resolve([]);
    },
  } as unknown as PrismaService;

  return { repo: new LootCatalogRepository(prisma), chamadas };
}

describe('LootCatalogRepository.upsertItem', () => {
  it('marca specsCuratedAt quando as specs vêm sem a marca de proposta', async () => {
    // Arquivo digitado à mão: a lista É a assinatura de quem editou.
    const { repo, chamadas } = montar(null);

    await repo.upsertItem({ itemId: 1, usableBySpecs: [SPECS.WARRIOR_ARMS] });

    expect(chamadas.transacoes).toBe(1);
    expect(chamadas.updates).toHaveLength(1);
    expect(chamadas.updates[0]?.specsCuratedAt).toBeInstanceOf(Date);
  });

  it('grava proposta do cliente SEM marcar specsCuratedAt', async () => {
    // Marcar faria o banco afirmar uma revisão que ninguém fez.
    const { repo, chamadas } = montar(null);

    await repo.upsertItem({
      itemId: 1,
      usableBySpecs: [SPECS.WARRIOR_ARMS],
      specsFromClient: true,
    });

    expect(chamadas.transacoes).toBe(1);
    expect(chamadas.createMany).toHaveLength(1);
    expect(chamadas.updates).toEqual([]);
  });

  it('não encosta em item que já tem curadoria humana', async () => {
    // É o caso do hotfix: regerar a raid devolveria a lista do cliente e
    // apagaria a correção feita à mão, com a carga reportando sucesso.
    const { repo, chamadas } = montar(new Date('2026-08-01'));

    await repo.upsertItem({
      itemId: 1,
      usableBySpecs: [SPECS.WARRIOR_ARMS],
      specsFromClient: true,
    });

    expect(chamadas.transacoes).toBe(0);
    expect(chamadas.createMany).toEqual([]);
  });

  it('curadoria humana SOBRESCREVE curadoria anterior', async () => {
    // A proteção é contra a máquina, não contra a pessoa: corrigir o que já foi
    // curado é justamente o fluxo normal.
    const { repo, chamadas } = montar(new Date('2026-08-01'));

    await repo.upsertItem({ itemId: 1, usableBySpecs: [SPECS.PALADIN_HOLY] });

    expect(chamadas.transacoes).toBe(1);
    expect(chamadas.updates).toHaveLength(1);
    expect(chamadas.updates[0]?.specsCuratedAt).toBeInstanceOf(Date);
  });

  it('lista vazia é "não decidi" e não apaga nada, mesmo com a marca', async () => {
    const { repo, chamadas } = montar(null);

    await repo.upsertItem({ itemId: 1, usableBySpecs: [], specsFromClient: true });

    expect(chamadas.transacoes).toBe(0);
    expect(chamadas.upsert).toBe(1);
  });

  it('não repassa a marca como coluna do item', async () => {
    // `specsFromClient` é instrução para o carregador, não campo do dicionário.
    // Se escapasse para o `upsert`, o Prisma reclamaria de argumento inexistente.
    const { repo } = montar(null);

    await expect(
      repo.upsertItem({ itemId: 1, name: 'Peça', specsFromClient: true }),
    ).resolves.toBeUndefined();
  });
});
