import { Injectable } from '@nestjs/common';
import type { PrimaryStat, RaidDifficultyLevel, WowSpec } from '@titan/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SPEC_TO_DB } from './spec-map';

export interface WowItemInput {
  itemId: number;
  name?: string | null;
  icon?: string | null;
  equipLoc?: string | null;
  itemSubclass?: string | null;
}

/**
 * O que o carregador grava de um item.
 *
 * Tudo opcional menos o id: campo ausente é "não mexi nisso". Ver `upsertItem`.
 */
export interface WowItemUpsert {
  itemId: number;
  name?: string;
  icon?: string;
  equipLoc?: string;
  itemSubclass?: string;
  primaryStats?: PrimaryStat[];
  usableBySpecs?: WowSpec[];

  /** `usableBySpecs` é proposta da máquina, não curadoria. Ver `upsertItem`. */
  specsFromClient?: boolean;
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
  primaryStats: true,
  specsCuratedAt: true,
  usableBySpecs: { select: { spec: true } },
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
    instanceMapId: true,
    encounters: {
      orderBy: { position: 'asc' },
      select: {
        id: true,
        name: true,
        position: true,
        dungeonEncounterId: true,
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
export class LootCatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  findRaids(filtro: RaidFilter = {}) {
    return this.prisma.lootCatalogRaid.findMany({
      where: 'seasonId' in filtro ? { seasonId: filtro.seasonId } : {},
      orderBy: { name: 'asc' },
      select: raidSelect(filtro.difficulty),
    });
  }

  /**
   * As raids sem os drops, para a lista.
   *
   * Consulta própria em vez de reaproveitar `findRaids` e descartar: o custo que
   * se quer evitar é o do banco trazer 468 drops com item e specs, então filtrar
   * depois não economizaria nada.
   *
   * `_count` dos encounters em vez de trazer a lista deles: quem chama quer saber
   * quantos bosses a raid tem, não quais.
   */
  findRaidSummaries(filtro: RaidFilter = {}) {
    return this.prisma.lootCatalogRaid.findMany({
      where: 'seasonId' in filtro ? { seasonId: filtro.seasonId } : {},
      orderBy: { name: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        seasonId: true,
        instanceMapId: true,
        _count: { select: { encounters: true } },
      },
    });
  }

  findRaidBySlug(slug: string, difficulty?: RaidDifficultyLevel) {
    return this.prisma.lootCatalogRaid.findUnique({
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
  async ensureItems(itens: WowItemInput[]): Promise<void> {
    for (const item of itens) {
      await this.prisma.wowItem.upsert({
        where: { itemId: item.itemId },
        create: item,
        update: {},
      });
    }
  }

  /**
   * O boss pelo id do jogo, com a raid dele.
   *
   * É por aqui que a colagem do addon vira sessão: o cabeçalho traz
   * `encounter=2687`, e achar o boss por esse número entrega **também** a raid,
   * pela relação. Por isso o `instanceMapId` da colagem é conferência e não
   * chave — a raid não precisa ser procurada.
   */
  findEncounterByDungeonId(dungeonEncounterId: number) {
    return this.prisma.lootCatalogEncounter.findUnique({
      where: { dungeonEncounterId },
      select: {
        id: true,
        name: true,
        position: true,
        dungeonEncounterId: true,
        raid: {
          select: { id: true, slug: true, name: true, seasonId: true, instanceMapId: true },
        },
      },
    });
  }

  /**
   * Cria ou atualiza a raid, casando por `slug`.
   *
   * `slug` é a identidade estável do arquivo de catálogo, e é o que torna a
   * recarga idempotente: rodar de novo atualiza a mesma linha.
   */
  upsertRaid(dados: { slug: string; name: string; seasonId?: number; instanceMapId?: number }) {
    const { slug, ...resto } = dados;

    return this.prisma.lootCatalogRaid.upsert({
      where: { slug },
      create: { slug, ...resto },
      update: resto,
      select: { id: true },
    });
  }

  /**
   * Cria ou atualiza o boss, casando por posição dentro da raid.
   *
   * A posição é a chave, e não o nome, porque nome muda com localização e com
   * correção de digitação — a ordem em que se mata, não.
   */
  upsertEncounter(dados: {
    raidId: string;
    name: string;
    position: number;
    dungeonEncounterId?: number;
  }) {
    const { raidId, position, ...resto } = dados;

    return this.prisma.lootCatalogEncounter.upsert({
      where: { raidId_position: { raidId, position } },
      create: { raidId, position, ...resto },
      update: resto,
      select: { id: true },
    });
  }

  /**
   * Deixa os drops do boss exatamente iguais aos da lista.
   *
   * Substitui em vez de acrescentar porque **o arquivo é a fonte da verdade**:
   * item que saiu da loot table por hotfix precisa sair do banco também, e um
   * carregador que só soma nunca esquece nada.
   *
   * Apagar drop é seguro: linha de loot e sessão guardam `itemId`, nunca a linha
   * de drop. Editar o catálogo não alcança histórico já gravado.
   */
  async replaceDrops(
    encounterId: string,
    drops: Array<{ difficulty: RaidDifficultyLevel; itemId: number }>,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.encounterDrop.deleteMany({ where: { encounterId } }),
      this.prisma.encounterDrop.createMany({
        data: drops.map((d) => ({ encounterId, ...d })),
      }),
    ]);
  }

  /**
   * Grava o item do dicionário sem destruir o que já se sabia dele.
   *
   * Campo ausente no arquivo significa "não mexi nisso", nunca "apague". O
   * arquivo pode ter sido digitado à mão com só o `itemId`, enquanto o banco já
   * tem nome e ícone vindos da API — sobrescrever com nulo perderia isso.
   *
   * `usableBySpecs` segue a mesma regra e é ainda mais sensível, porque envolve
   * curadoria humana. Lista vazia no arquivo é "não decidi".
   *
   * Com `specsFromClient`, as specs são proposta da máquina: gravam sem marcar
   * `specsCuratedAt`, e não encostam em item que já tem curadoria.
   */
  async upsertItem(dados: WowItemUpsert): Promise<void> {
    const { itemId, usableBySpecs, specsFromClient, ...campos } = dados;

    // Só o que veio. `undefined` é "não mexi nisso", e cair no update como nulo
    // apagaria enriquecimento que a API já tinha trazido.
    const preenchidos = Object.fromEntries(
      Object.entries(campos).filter(([, valor]) => valor !== undefined),
    );

    const enriquecido = Object.keys(preenchidos).length > 0 ? { enrichedAt: new Date() } : {};

    await this.prisma.wowItem.upsert({
      where: { itemId },
      create: { itemId, ...preenchidos, ...enriquecido },
      update: { ...preenchidos, ...enriquecido },
    });

    // Lista vazia é "não decidi", nunca "ninguém usa" — arquivo digitado à mão
    // vem assim, e apagar curadoria humana por causa disso seria destrutivo.
    if (!usableBySpecs || usableBySpecs.length === 0) return;

    /*
     * Proposta da máquina não passa por cima de humano.
     *
     * O item que já tem `specsCuratedAt` fica intacto: sem esta saída, regerar a
     * raid depois de um hotfix devolveria a lista do cliente e apagaria a
     * correção que alguém fez à mão — em silêncio, porque a carga reportaria
     * sucesso.
     */
    if (specsFromClient) {
      const atual = await this.prisma.wowItem.findUnique({
        where: { itemId },
        select: { specsCuratedAt: true },
      });

      if (atual?.specsCuratedAt) return;
    }

    await this.prisma.$transaction([
      this.prisma.wowItemSpec.deleteMany({ where: { itemId } }),
      this.prisma.wowItemSpec.createMany({
        data: usableBySpecs.map((spec) => ({ itemId, spec: SPEC_TO_DB[spec] })),
      }),
      // `specsCuratedAt` significa "um humano olhou", então proposta não o marca.
      // Marcar faria o banco afirmar uma revisão que ninguém fez.
      ...(specsFromClient
        ? []
        : [
            this.prisma.wowItem.update({
              where: { itemId },
              data: { specsCuratedAt: new Date() },
            }),
          ]),
    ]);
  }

  /** Itens que nunca foram enriquecidos — a fila do job que preenche nome e ícone. */
  findItemsToEnrich(limite: number) {
    return this.prisma.wowItem.findMany({
      where: { enrichedAt: null },
      take: limite,
      select: { itemId: true },
    });
  }
}
