import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * O repository do Round Closing Report (§16.7), separado do resto do Titan
 * Bet de propósito: ele só lê o **resultado confirmado**, o **ledger** e o
 * personagem de elegibilidade de cada conta (D-48). Não lê aposta, escolha,
 * valor apostado, total esperado nem quem é a conta — o que não é lido não
 * vaza (guarda T-C03).
 */
@Injectable()
export class ClosingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** A rodada e a auditoria confirmada, com os resultados e seus vencedores. */
  rodadaConfirmada(roundId: string) {
    return this.prisma.betRound.findUnique({
      where: { id: roundId },
      select: {
        id: true,
        period: true,
        audits: {
          where: { status: 'confirmada' },
          select: {
            id: true,
            results: {
              orderBy: { computedAt: 'asc' },
              select: {
                marketId: true,
                outcome: true,
                voidReason: true,
                market: {
                  select: { kind: true, roundEncounter: { select: { encounterName: true } } },
                },
                winners: { select: { candidate: { select: { name: true, realm: true } } } },
                kills: { select: { roundEncounter: { select: { encounterName: true } } } },
              },
            },
          },
        },
      },
    });
  }

  /**
   * Os lançamentos da rodada, com o personagem de elegibilidade da conta (nome
   * e realm do snapshot de bettors) — nada mais da conta.
   */
  lancamentosDaRodada(roundId: string) {
    return this.prisma.goldLedgerEntry.findMany({
      where: { roundId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        kind: true,
        amount: true,
        marketId: true,
        slip: { select: { eligibility: { select: { name: true, realm: true } } } },
      },
    });
  }

  /** Publica a próxima versão; o unique `(roundId, version)` segura duas ao mesmo tempo. */
  async publicar(p: {
    roundId: string;
    auditId: string;
    ledgerThroughEntryId: bigint;
    content: Prisma.InputJsonObject;
    officer: { userId: string; battletag: string };
  }): Promise<{ version: number }> {
    return this.prisma.$transaction(async (tx) => {
      const ultima = await tx.roundClosingReport.aggregate({
        where: { roundId: p.roundId },
        _max: { version: true },
      });
      const version = (ultima._max.version ?? 0) + 1;
      await tx.roundClosingReport.create({
        data: {
          roundId: p.roundId,
          version,
          auditId: p.auditId,
          ledgerThroughEntryId: p.ledgerThroughEntryId,
          content: p.content,
          // Quem publicou é o officer (§16.7) — não a identidade de um membro.
          publishedByUserId: p.officer.userId,
          publishedByBattletag: p.officer.battletag,
        },
      });
      return { version };
    });
  }

  /** A última versão publicada da rodada. */
  ultimo(roundId: string) {
    return this.prisma.roundClosingReport.findFirst({
      where: { roundId },
      orderBy: { version: 'desc' },
      select: { version: true, publishedAt: true, content: true },
    });
  }
}
