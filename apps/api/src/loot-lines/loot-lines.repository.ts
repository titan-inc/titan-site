import { Injectable } from '@nestjs/common';
import type { LootLineSource, RaidDifficultyLevel } from '@titan/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Uma linha pronta para gravar.
 *
 * Campo a campo de propósito, e não um spread do registro da fonte: o export tem
 * 22 campos e a tabela guarda outros, então espalhar o objeto inteiro faria o
 * Prisma receber colunas que não existem — erro em runtime, longe daqui.
 */
export interface LootLineUpsert {
  source: LootLineSource;
  externalId: string;
  awardedAt: Date;

  winnerNameKey: string;
  winnerRealmKey: string;
  winnerName: string;
  winnerRealm: string;
  winnerClass: string | null;

  looterNameKey: string | null;
  looterRealmKey: string | null;
  looterName: string | null;
  looterRealm: string | null;

  itemId: number;
  itemString: string;

  rawInstance: string;
  rawBoss: string;
  encounterId: string | null;
  difficulty: RaidDifficultyLevel | null;

  responseOptionSlug: string;
  rawResponse: string;
  rawResponseId: string;

  votes: number | null;
  note: string | null;
  rawReplacedGear: string[];
}

/** Um boss do catálogo, o mínimo para casar com o nome que a fonte escreveu. */
export interface EncounterRef {
  id: string;
  name: string;
}

@Injectable()
export class LootLinesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Todos os bosses do catálogo.
   *
   * A lista inteira de uma vez, e não uma consulta por linha: são quatro raids e
   * algumas dezenas de bosses contra 294 linhas a importar. Uma consulta e um
   * `Map` na memória batem 294 idas ao banco sem chegar perto de pesar.
   */
  findEncounters(): Promise<EncounterRef[]> {
    return this.prisma.lootCatalogEncounter.findMany({ select: { id: true, name: true } });
  }

  /** Os slugs de resposta que existem hoje, para conferir antes de gravar. */
  async findResponseOptionSlugs(): Promise<string[]> {
    const opcoes = await this.prisma.lootResponseOption.findMany({ select: { slug: true } });
    return opcoes.map((o) => o.slug);
  }

  /**
   * Grava as linhas, atualizando as que já existem.
   *
   * Tudo numa transação só: ou o arquivo entrou, ou não entrou. Import pela
   * metade é pior que import nenhum, porque parece que funcionou — e a contagem
   * final é justamente o critério de aceite.
   *
   * A chave é `(source, externalId)`, que é o que faz rodar duas vezes atualizar
   * em vez de duplicar.
   */
  async upsertMany(linhas: LootLineUpsert[]): Promise<number> {
    const gravacoes = linhas.map((linha) =>
      this.prisma.lootLine.upsert({
        where: { source_externalId: { source: linha.source, externalId: linha.externalId } },
        create: linha,
        update: linha,
      }),
    );

    const feitas = await this.prisma.$transaction(gravacoes);
    return feitas.length;
  }

  countBySource(source: LootLineSource): Promise<number> {
    return this.prisma.lootLine.count({ where: { source } });
  }

  /**
   * Uma página do histórico, com o total sob os mesmos filtros.
   *
   * Os dois numa transação só para a contagem não discordar da página quando um
   * import roda no meio — a tela diria "37 entregas" mostrando 38.
   *
   * Ordem: mais recente primeiro, com o `id` desempatando. Sem o desempate, duas
   * entregas do mesmo instante — o export tem esse caso — podem trocar de lugar
   * entre uma página e outra, e a mesma linha aparece duas vezes ou some.
   */
  async findHistoryPage(
    where: Prisma.LootLineWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ linhas: LootHistoryRow[]; total: number }> {
    const [linhas, total] = await this.prisma.$transaction([
      this.prisma.lootLine.findMany({
        where,
        orderBy: [{ awardedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: historySelect,
      }),
      this.prisma.lootLine.count({ where }),
    ]);

    return { linhas, total };
  }

  /**
   * Os itens do catálogo referenciados por estas linhas.
   *
   * Consulta separada, e não `include`, porque **não existe FK de `LootLine`
   * para `WowItem`** — de propósito. FK obrigatória recusaria histórico cujo
   * item o catálogo ainda não tem, e catálogo atrasado não pode barrar registro
   * que não volta (Regra 7). Mesmo motivo pelo qual `encounterId` é nulável.
   */
  findItems(itemIds: number[]): Promise<CatalogItemRow[]> {
    return this.prisma.wowItem.findMany({
      where: { itemId: { in: itemIds } },
      select: { itemId: true, name: true, icon: true, equipLoc: true },
    });
  }

  /** Os `itemId` de um slot, para o filtro de slot virar `itemId IN (...)`. */
  async findItemIdsBySlot(equipLoc: string): Promise<number[]> {
    const itens = await this.prisma.wowItem.findMany({
      where: { equipLoc },
      select: { itemId: true },
    });

    return itens.map((i) => i.itemId);
  }
}

/**
 * Colunas que a tela do histórico precisa.
 *
 * `rawBoss` e `rawInstance` entram porque são o fallback de 26% das linhas, que
 * não resolveram para boss do catálogo.
 */
const historySelect = {
  id: true,
  awardedAt: true,
  winnerNameKey: true,
  winnerRealmKey: true,
  winnerName: true,
  winnerRealm: true,
  winnerClass: true,
  itemId: true,
  rawBoss: true,
  rawInstance: true,
  difficulty: true,
  votes: true,
  note: true,
  encounter: { select: { id: true, name: true, raid: { select: { name: true } } } },
  responseOption: { select: { slug: true, label: true } },
} as const;

export type LootHistoryRow = Prisma.LootLineGetPayload<{ select: typeof historySelect }>;
export type CatalogItemRow = {
  itemId: number;
  name: string | null;
  icon: string | null;
  equipLoc: string | null;
};
