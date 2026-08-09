import { Injectable } from '@nestjs/common';
import type { CatalogItem, CatalogRaid, RaidDifficultyLevel } from '@titan/shared';
import { CatalogRepository, type RaidFilter } from './catalog.repository';
import { SPEC_FROM_DB } from './spec-map';

/** O que o repository devolve, antes de virar o contrato do shared. */
type RaidRow = Awaited<ReturnType<CatalogRepository['findRaids']>>[number];
type ItemRow = RaidRow['encounters'][number]['drops'][number]['item'];

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
        item: toCatalogItem(drop.item),
      })),
    })),
  };
}

/**
 * Traduz o item, achatando as specs e convertendo o enum do banco para o slug.
 *
 * `usableBySpecs` vazio com `specsCuratedAt` nulo significa "ninguém revisou",
 * não "nenhuma spec usa". Quem consome precisa tratar os dois casos diferente —
 * é o mesmo cuidado da Regra 7 com lacuna e zero.
 */
function toCatalogItem(item: ItemRow): CatalogItem {
  return {
    itemId: item.itemId,
    name: item.name,
    icon: item.icon,
    equipLoc: item.equipLoc,
    itemSubclass: item.itemSubclass,
    primaryStats: item.primaryStats,
    usableBySpecs: item.usableBySpecs.map((s) => SPEC_FROM_DB[s.spec]),
    specsCuratedAt: item.specsCuratedAt?.toISOString() ?? null,
  };
}
