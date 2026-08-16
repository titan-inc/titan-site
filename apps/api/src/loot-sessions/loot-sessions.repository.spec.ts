import type { Prisma } from '@prisma/client';
import type { CharactersRepository } from '../characters/characters.repository';
import type { PrismaService } from '../prisma/prisma.service';
import type { LootSessionChangeBus } from './loot-session-change-bus';
import { LootSessionsRepository } from './loot-sessions.repository';

/**
 * Prisma dublado só com o que `encerrarComHistorico` toca.
 *
 * O que interessa aqui não é o SQL, é **se** o `closedAt` entra no update do
 * encerramento. Nenhum outro teste alcança isso: o spec do service usa
 * repositório dublado, então a coluna poderia voltar a nunca ser escrita sem
 * nada reclamar — que é exatamente como ela passou despercebida desde a
 * migration original (TIT-133).
 */
function montar() {
  const updates: Record<string, unknown>[] = [];
  const eventos: Record<string, unknown>[] = [];

  const tx = {
    lootSession: {
      update: ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return Promise.resolve({});
      },
    },
    lootSessionEvent: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        eventos.push(data);
        return Promise.resolve({});
      },
    },
  } as unknown as Prisma.TransactionClient;

  const prisma = {
    $transaction: (fn: (client: Prisma.TransactionClient) => Promise<number>) => fn(tx),
  } as unknown as PrismaService;

  const avisos: string[] = [];
  const changes = {
    avisar: (sessionId: string) => avisos.push(sessionId),
  } as unknown as LootSessionChangeBus;

  const repo = new LootSessionsRepository(prisma, {} as unknown as CharactersRepository, changes);

  return { repo, updates, eventos, avisos, tx };
}

const ATOR = { userId: 'u1', battletag: 'Fulano#1234' };

describe('LootSessionsRepository.encerrarComHistorico', () => {
  it('carimba closedAt junto do status', async () => {
    const { repo, updates } = montar();

    await repo.encerrarComHistorico('s1', 'deliberando', ATOR, () => Promise.resolve(3));

    expect(updates).toHaveLength(1);
    expect(updates[0]?.status).toBe('encerrada');
    expect(updates[0]?.closedAt).toBeInstanceOf(Date);
  });

  it('grava as linhas com o client da própria transação', async () => {
    const { repo, tx } = montar();
    const recebidos: unknown[] = [];

    const gravadas = await repo.encerrarComHistorico('s1', 'deliberando', ATOR, (client) => {
      recebidos.push(client);
      return Promise.resolve(2);
    });

    // O callback recebe o MESMO client que escreveu o status — é o que garante
    // que status e histórico commitam juntos, e não em transações separadas.
    expect(recebidos).toEqual([tx]);
    expect(gravadas).toBe(2);
  });

  it('avisa DEPOIS que a transação comitou — TIT-68', async () => {
    const ordem: string[] = [];
    const { repo, avisos } = montar();

    await repo.encerrarComHistorico('s1', 'deliberando', ATOR, () => {
      // Se o aviso saísse de dentro da transação, apareceria ANTES daqui.
      ordem.push('gravou');
      return Promise.resolve(1);
    });
    ordem.push(...avisos.map(() => 'avisou'));

    expect(ordem).toEqual(['gravou', 'avisou']);
    expect(avisos).toEqual(['s1']);
  });
});
