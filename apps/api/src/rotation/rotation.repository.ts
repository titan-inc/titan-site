import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Uma noite com o que decide se um banco planejado foi cumprido. */
export interface PresencaDaSemana {
  characterId: string;
  date: string;
  signup: string | null;
  raided: boolean | null;
}

/** Único lugar do módulo rotation que fala com o Prisma — ver Regra 3. */
@Injectable()
export class RotationRepository {
  constructor(private readonly prisma: PrismaService) {}

  listRoleLocks() {
    return this.prisma.rotationRoleLock.findMany({ orderBy: { role: 'asc' } });
  }

  /** Substitui o conjunto inteiro: a tela manda o estado final dos checkboxes. */
  async setRoleLocks(roles: string[], lockedBy: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.rotationRoleLock.deleteMany({ where: { role: { notIn: roles } } }),
      ...roles.map((role) =>
        this.prisma.rotationRoleLock.upsert({
          where: { role },
          create: { role, lockedBy },
          // Já travada continua com o `lockedAt` original — remarcar faria a
          // trava parecer nova toda vez que outro checkbox mudasse.
          update: {},
        }),
      ),
    ]);
  }

  listPlayerLocks() {
    return this.prisma.rotationPlayerLock.findMany({
      include: { character: true },
      orderBy: { lockedAt: 'asc' },
    });
  }

  createPlayerLock(characterId: string, reason: string, lockedBy: string) {
    return this.prisma.rotationPlayerLock.upsert({
      where: { characterId },
      create: { characterId, reason, lockedBy },
      // Travar de novo é reescrever o motivo, não empilhar travas. O `lockedAt`
      // fica: quem edita o texto não zera "há quantas semanas está travado".
      update: { reason, lockedBy },
    });
  }

  deletePlayerLock(id: string) {
    return this.prisma.rotationPlayerLock.delete({ where: { id } });
  }

  findPlan(weekStart: string) {
    return this.prisma.rotationPlan.findUnique({
      where: { weekStart },
      include: { entries: true },
    });
  }

  /**
   * Grava o plano da semana, substituindo o anterior.
   *
   * Numa transação porque plano salvo pela metade é pior que plano não salvo:
   * a tela mostraria um banco que ninguém decidiu.
   */
  async savePlan(
    weekStart: string,
    seats: number,
    characterIds: string[],
    savedBy: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const plan = await tx.rotationPlan.upsert({
        where: { weekStart },
        create: { weekStart, seats, savedBy },
        update: { seats, savedBy },
      });

      await tx.rotationPlanEntry.deleteMany({ where: { planId: plan.id } });
      if (characterIds.length > 0) {
        await tx.rotationPlanEntry.createMany({
          data: characterIds.map((characterId) => ({ planId: plan.id, characterId })),
        });
      }
    });
  }

  /** Todos os bancos já planejados, do mais recente para o mais antigo. */
  listPlanEntries(characterIds: string[]) {
    if (characterIds.length === 0) return Promise.resolve([]);

    return this.prisma.rotationPlanEntry.findMany({
      where: { characterId: { in: characterIds } },
      include: { plan: { select: { weekStart: true } } },
      orderBy: { plan: { weekStart: 'desc' } },
    });
  }

  /**
   * `Standby` já gravado na presença — o histórico de onde a primeira sugestão
   * é extrapolada, antes de existir plano salvo nenhum.
   *
   * Proxy imperfeito de propósito: não distingue quem declarou banco de quem o
   * raid leader sentou na hora. Ainda assim é melhor que ordenar 26 pessoas
   * empatadas em zero, e em duas ou três semanas o plano salvo assume.
   */
  listStandbys(characterIds: string[]) {
    if (characterIds.length === 0) return Promise.resolve([]);

    return this.prisma.raidAttendance.findMany({
      where: { characterId: { in: characterIds }, signup: 'Standby' },
      select: { characterId: true, raidNight: { select: { date: true } } },
      orderBy: { raidNight: { date: 'desc' } },
    });
  }

  /** Presença das noites de um intervalo, para cruzar com o plano. */
  async listPresenca(characterIds: string[], de: string, ate: string): Promise<PresencaDaSemana[]> {
    if (characterIds.length === 0) return [];

    const linhas = await this.prisma.raidAttendance.findMany({
      where: {
        characterId: { in: characterIds },
        raidNight: { date: { gte: de, lte: ate } },
      },
      select: {
        characterId: true,
        signup: true,
        raided: true,
        raidNight: { select: { date: true } },
      },
    });

    return linhas.map((l) => ({
      characterId: l.characterId,
      date: l.raidNight.date,
      signup: l.signup,
      raided: l.raided,
    }));
  }
}
