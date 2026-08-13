import { Injectable } from '@nestjs/common';
import type { LootLineSource, RaidDifficultyLevel } from '@titan/shared';
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
}
