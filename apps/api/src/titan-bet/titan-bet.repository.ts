import { Injectable } from '@nestjs/common';
import type { BetCandidateRole, BetEventType, BetMarketKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Uma linha do snapshot de bettors (D-32, D-38). */
export interface BettorDoReady {
  characterId: string;
  rank: number;
  name: string;
  realm: string;
}

/** Uma linha do snapshot de candidatos (D-33). */
export interface CandidatoDoReady {
  characterId: string;
  role: BetCandidateRole;
  name: string;
  realm: string;
}

export interface GravacaoDoReady {
  roundId: string;
  officer: { userId: string; battletag: string };
  readyAt: Date;
  bettors: BettorDoReady[];
  candidatos: CandidatoDoReady[];
  bettorSourceFetchedAt: Date;
  candidateSourceFetchedAt: Date;
}

/** O que o Ready precisa ler da rodada antes de congelá-la. */
export interface RodadaParaReady {
  id: string;
  cutoffAt: Date;
  readyAt: Date | null;
  markets: Array<{ kind: BetMarketKind }>;
  encounters: Array<{ inWeeklyProgression: boolean }>;
}

/**
 * Único lugar do Titan Bet que toca o Prisma (Regra 3).
 *
 * As invariantes estruturais não moram aqui: estão no banco (CHECK, FK
 * composta, índices parciais e triggers — spec §16.4). O repository só lê e
 * grava; quem recusa o que não pode é o Postgres.
 */
@Injectable()
export class TitanBetRepository {
  constructor(private readonly prisma: PrismaService) {}

  rodadaParaReady(roundId: string): Promise<RodadaParaReady | null> {
    return this.prisma.betRound.findUnique({
      where: { id: roundId },
      select: {
        id: true,
        cutoffAt: true,
        readyAt: true,
        markets: { select: { kind: true } },
        encounters: { select: { inWeeklyProgression: true } },
      },
    });
  }

  /**
   * O configuration freeze (D-31), numa transação só: snapshots e `readyAt`
   * entram juntos ou nada entra.
   *
   * O `readyAt` é gravado por último e só se ainda estiver nulo — dois Ready
   * concorrentes não passam os dois.
   */
  async gravarReady(g: GravacaoDoReady): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.betRoundBettor.createMany({
        data: g.bettors.map((b) => ({ roundId: g.roundId, ...b })),
      });
      await tx.betRoundCandidate.createMany({
        data: g.candidatos.map((c) => ({ roundId: g.roundId, ...c })),
      });

      const pronta = await tx.betRound.updateMany({
        where: { id: g.roundId, readyAt: null },
        data: {
          readyAt: g.readyAt,
          readyByUserId: g.officer.userId,
          readyByBattletag: g.officer.battletag,
          bettorSourceFetchedAt: g.bettorSourceFetchedAt,
          candidateSourceFetchedAt: g.candidateSourceFetchedAt,
        },
      });
      if (pronta.count !== 1) {
        throw new Error(`a rodada ${g.roundId} já teve Ready`);
      }
    });
  }

  async registrarEvento(e: {
    roundId: string;
    type: BetEventType;
    actor: { userId: string; battletag: string };
    payload: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.betEvent.create({
      data: {
        roundId: e.roundId,
        type: e.type,
        actorUserId: e.actor.userId,
        actorBattletag: e.actor.battletag,
        payload: e.payload,
      },
    });
  }

  /**
   * Personagens da conta que estão no snapshot de bettors da rodada, do melhor
   * rank para o pior. A ligação conta ↔ personagem é o `GuildCharacter` de
   * agora (D-38): um login feito depois do Ready associa, mas não muda o
   * snapshot.
   */
  personagensDaContaNoSnapshot(
    roundId: string,
    userId: string,
  ): Promise<Array<{ characterId: string; rank: number }>> {
    return this.prisma.betRoundBettor.findMany({
      where: { roundId, character: { guildCharacter: { userId } } },
      select: { characterId: true, rank: true },
      orderBy: [{ rank: 'asc' }, { characterId: 'asc' }],
    });
  }
}
