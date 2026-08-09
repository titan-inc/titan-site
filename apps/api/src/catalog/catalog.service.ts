import { Injectable } from '@nestjs/common';
import type { CatalogRaid, RaidDifficultyLevel } from '@titan/shared';
import { CatalogRepository, type RaidFilter } from './catalog.repository';

/** O que o repository devolve, antes de virar o contrato do shared. */
type RaidRow = Awaited<ReturnType<CatalogRepository['findRaids']>>[number];

/**
 * Leitura do catálogo de loot.
 *
 * O catálogo é lookup, não fonte da verdade do que aconteceu: a linha de loot e
 * a sessão ao vivo guardam `itemId`, nunca a linha de drop. É isso que faz
 * editar o catálogo — corrigir uma loot table, arquivar uma raid — nunca
 * corromper histórico já gravado.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly repo: CatalogRepository) {}

  async listRaids(filtro: RaidFilter = {}): Promise<CatalogRaid[]> {
    const raids = await this.repo.findRaids(filtro);
    return raids.map(toCatalogRaid);
  }

  async getRaid(slug: string, difficulty?: RaidDifficultyLevel): Promise<CatalogRaid | null> {
    const raid = await this.repo.findRaidBySlug(slug, difficulty);
    return raid ? toCatalogRaid(raid) : null;
  }
}

/**
 * Traduz a linha do Prisma para o contrato do shared.
 *
 * Parece cópia, e é de propósito: é aqui que o enum do banco vira o union do
 * `packages/shared`. Se um dia os dois divergirem, é este ponto que quebra no
 * typecheck — em vez de o front receber um valor que ele não sabe tratar.
 */
function toCatalogRaid(raid: RaidRow): CatalogRaid {
  return {
    id: raid.id,
    slug: raid.slug,
    name: raid.name,
    seasonId: raid.seasonId,
    encounters: raid.encounters.map((encounter) => ({
      id: encounter.id,
      name: encounter.name,
      position: encounter.position,
      drops: encounter.drops.map((drop) => ({
        difficulty: drop.difficulty,
        item: drop.item,
      })),
    })),
  };
}
