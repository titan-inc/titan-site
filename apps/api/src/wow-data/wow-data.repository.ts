import { Injectable } from '@nestjs/common';
import type { BonusFacets } from '@titan/shared';
import { PrismaService } from '../prisma/prisma.service';

const facetasSelect = {
  bonusId: true,
  trackName: true,
  trackRank: true,
  trackMaxRank: true,
  trackScalingId: true,
  itemLevel: true,
  tertiary: true,
  hasSocket: true,
  binding: true,
  difficulty: true,
  difficultyColor: true,
  quality: true,
} as const;

/**
 * O ÚNICO lugar que lê as tabelas versionadas por build — TIT-137.
 *
 * ## Por que "único" é restrição e não organização
 *
 * `WowItemData`, `WowBonus`, `WowItemContextBonus` e `WowItemLevelScaling` têm
 * `buildId` na chave. **Uma consulta que esqueça de filtrar pelo build ativo
 * mistura dois builds e não dá erro nenhum** — é a mesma classe de falha
 * silenciosa que a pesquisa da TIT-136 passou doze rodadas perseguindo.
 *
 * A contenção é não existir outro lugar onde esquecer. A Regra 3 já manda
 * `PrismaClient` só no repository; esta classe estreita isso mais: destas
 * quatro tabelas, só ela lê.
 *
 * ## O build vem por parâmetro, nunca é reconsultado aqui
 *
 * Todo método recebe `buildId` de fora. Se cada método resolvesse o ativo por
 * conta própria, uma troca de build no meio de uma requisição faria a primeira
 * consulta ler um e a segunda ler outro — de novo, sem erro. Quem resolve o
 * ativo é o service, uma vez, e carrega adiante.
 */
@Injectable()
export class WowDataRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * O build que a guilda enxerga, ou `null` se nenhum foi ativado ainda.
   *
   * Nulo é estado legítimo — é como o banco nasce, antes da primeira carga.
   * Quem chama devolve lacuna, nunca estoura: a tela mostrando um buraco é
   * infinitamente melhor que um stack trace na cara do raid leader numa terça.
   */
  async buildAtivo(): Promise<string | null> {
    const linha = await this.prisma.wowDataBuild.findFirst({
      where: { active: true },
      select: { buildId: true },
    });
    return linha?.buildId ?? null;
  }

  /**
   * As facetas destes bonus ids, no build dado. O que não existir simplesmente
   * não volta — ausente é DESCONHECIDO, nunca uma linha de nulos.
   */
  async facetasDeBonus(buildId: string, bonusIds: number[]): Promise<BonusFacets[]> {
    if (bonusIds.length === 0) return [];

    return this.prisma.wowBonus.findMany({
      where: { buildId, bonusId: { in: bonusIds } },
      select: facetasSelect,
    });
  }

  /** Todo bonus id que este build conhece — para o relatório de desconhecidos. */
  async idsDeBonusConhecidos(buildId: string): Promise<Set<number>> {
    const linhas = await this.prisma.wowBonus.findMany({
      where: { buildId },
      select: { bonusId: true },
    });
    return new Set(linhas.map((l) => l.bonusId));
  }
}
