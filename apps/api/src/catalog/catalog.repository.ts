import { Injectable } from '@nestjs/common';
import type { RaidDifficultyLevel } from '@titan/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface CatalogItemInput {
  itemId: number;
  name?: string | null;
  icon?: string | null;
  equipLoc?: string | null;
  itemSubclass?: string | null;
}

export interface RaidFilter {
  /**
   * Nulo é filtro legítimo: "as raids que ainda não foram ligadas a uma season",
   * que é o estado normal de uma raid cadastrada antes da season começar.
   * Omitir o campo é que significa "todas".
   */
  seasonId?: number | null;
  difficulty?: RaidDifficultyLevel;
}

/** Colunas do item que a tela precisa. Uma lista só, usada em toda consulta. */
const itemSelect = {
  itemId: true,
  name: true,
  icon: true,
  equipLoc: true,
  itemSubclass: true,
} as const;

/**
 * A raid inteira em uma consulta: bosses em ordem, cada um com seus drops.
 *
 * O filtro de dificuldade entra no `where` do nível mais interno, e não descarta
 * bosses: um boss sem drop naquela dificuldade aparece com lista vazia, que é a
 * resposta certa para "o que este boss solta no mítico?" quando a resposta é
 * "nada cadastrado ainda".
 */
function raidSelect(difficulty?: RaidDifficultyLevel) {
  return {
    id: true,
    slug: true,
    name: true,
    seasonId: true,
    encounters: {
      orderBy: { position: 'asc' },
      select: {
        id: true,
        name: true,
        position: true,
        drops: {
          where: difficulty ? { difficulty } : {},
          select: { difficulty: true, item: { select: itemSelect } },
        },
      },
    },
  } as const;
}

/**
 * Único lugar do módulo catálogo que fala com o Prisma — ver Regra 3.
 */
@Injectable()
export class CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  findRaids(filtro: RaidFilter = {}) {
    return this.prisma.catalogRaid.findMany({
      where: 'seasonId' in filtro ? { seasonId: filtro.seasonId } : {},
      orderBy: { name: 'asc' },
      select: raidSelect(filtro.difficulty),
    });
  }

  findRaidBySlug(slug: string, difficulty?: RaidDifficultyLevel) {
    return this.prisma.catalogRaid.findUnique({
      where: { slug },
      select: raidSelect(difficulty),
    });
  }

  /**
   * Garante que os itens existem no dicionário sem apagar enriquecimento.
   *
   * O `update` é vazio de propósito: quem cadastra um drop sabe o `itemID` e
   * nada mais, então sobrescrever com nulo apagaria nome e ícone já buscados na
   * API. Enriquecer é trabalho de outro fluxo.
   */
  async ensureItems(itens: CatalogItemInput[]): Promise<void> {
    for (const item of itens) {
      await this.prisma.catalogItem.upsert({
        where: { itemId: item.itemId },
        create: item,
        update: {},
      });
    }
  }

  /** Itens que nunca foram enriquecidos — a fila do job que preenche nome e ícone. */
  findItemsToEnrich(limite: number) {
    return this.prisma.catalogItem.findMany({
      where: { enrichedAt: null },
      take: limite,
      select: { itemId: true },
    });
  }
}
