import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SeasonInput {
  id: number;
  name: string;
  patch: string | null;
  firstPeriod: number;
  periodCount: number;
  startedAt: Date;
}

export interface SnapshotInput {
  period: number;
  seasonId: number;
  /** Identidade já resolvida — quem resolve é o `CharactersRepository`. */
  characterId: string;
  itemLevel: number | null;
  mythicPlusScore: number | null;
  keysDone: number | null;
  highestKey: number | null;
  seasonRuns: number | null;
  seasonRunsTimed: number | null;
}

/**
 * Único lugar do módulo snapshots que fala com o Prisma — ver Regra 3.
 */
@Injectable()
export class SnapshotsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Grava ou atualiza a season. O id é o da Blizzard, não nosso. */
  async upsertSeason(input: SeasonInput): Promise<void> {
    const { id, ...resto } = input;
    await this.prisma.gameSeason.upsert({
      where: { id },
      create: { id, ...resto },
      update: resto,
    });
  }

  /**
   * Grava a foto da semana.
   *
   * Upsert pela chave (period, realm, nome): rodar o job duas vezes na mesma
   * semana **atualiza** a linha em vez de duplicar. Semanas passadas nunca são
   * reescritas, porque cada rodada só mexe no period corrente.
   *
   * @returns quantos personagens foram gravados
   */
  async saveSnapshots(entradas: SnapshotInput[]): Promise<number> {
    for (const e of entradas) {
      const { period, characterId, ...resto } = e;
      await this.prisma.characterSnapshot.upsert({
        where: { period_characterId: { period, characterId } },
        create: { period, characterId, ...resto },
        update: { ...resto, recordedAt: new Date() },
      });
    }

    return entradas.length;
  }

  /**
   * Grava SÓ as chaves de uma semana.
   *
   * Existe separado do snapshot completo por causa do backfill: semanas
   * passadas têm chaves (o WoWAudit guarda) mas não têm item level (o
   * Raider.IO só dá o agora). Usar o upsert completo aqui apagaria o item
   * level já medido da semana corrente, trocando dado real por nulo.
   */
  async saveWeeklyKeys(
    period: number,
    seasonId: number,
    entradas: Array<{ characterId: string; keysDone: number; highestKey: number | null }>,
  ): Promise<number> {
    for (const e of entradas) {
      const { characterId, keysDone, highestKey } = e;
      await this.prisma.characterSnapshot.upsert({
        where: { period_characterId: { period, characterId } },
        create: { period, seasonId, characterId, keysDone, highestKey },
        // Só as chaves. itemLevel e score ficam como estão.
        update: { keysDone, highestKey },
      });
    }

    return entradas.length;
  }

  /** Seasons gravadas, mais recentes primeiro. */
  listSeasons(limite: number) {
    return this.prisma.gameSeason.findMany({
      orderBy: { startedAt: 'desc' },
      take: limite,
      select: {
        id: true,
        patch: true,
        name: true,
        raiderioSlug: true,
        firstPeriod: true,
        periodCount: true,
        startedAt: true,
      },
    });
  }

  /** Uma season específica, ou null. */
  findSeason(id: number) {
    return this.prisma.gameSeason.findUnique({
      where: { id },
      select: {
        id: true,
        patch: true,
        name: true,
        raiderioSlug: true,
        firstPeriod: true,
        periodCount: true,
        startedAt: true,
      },
    });
  }

  /**
   * De quem é este slug do Raider.IO, se de alguém.
   *
   * A pergunta que importa é "já pertence a uma season mais antiga?" — se sim,
   * o M+ da season nova ainda não abriu. Ver `SnapshotsService`.
   */
  findSeasonByRaiderioSlug(slug: string) {
    return this.prisma.gameSeason.findUnique({
      where: { raiderioSlug: slug },
      select: { id: true },
    });
  }

  /** Marca a season como aberta no Raider.IO, e com qual slug. */
  async setRaiderioSlug(id: number, slug: string): Promise<void> {
    await this.prisma.gameSeason.update({ where: { id }, data: { raiderioSlug: slug } });
  }

  /** Todas as fotos de uma season, para montar o relatório de uma vez só. */
  findSeasonSnapshots(seasonId: number) {
    return this.prisma.characterSnapshot.findMany({
      where: { seasonId },
      orderBy: { period: 'asc' },
      select: {
        period: true,
        characterId: true,
        character: { select: { name: true, realm: true, nameKey: true, realmKey: true } },
        itemLevel: true,
        keysDone: true,
        highestKey: true,
        seasonRuns: true,
        seasonRunsTimed: true,
      },
    });
  }
}
