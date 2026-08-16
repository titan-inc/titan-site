import { Injectable } from '@nestjs/common';
import { parseItemString } from '@titan/shared';
import { LootCatalogRepository } from '../loot-catalog/loot-catalog.repository';
import { LootLinesService } from '../loot-lines/loot-lines.service';
import { LootSessionsService } from '../loot-sessions/loot-sessions.service';
import { WowBonusRepository } from './wow-bonus.repository';

export interface RelatorioDeDesconhecidos {
  /** Bonus IDs fora do dicionário, mais frequente primeiro. */
  bonusIds: Array<{ bonusId: number; ocorrencias: number }>;
  /** `itemId` sem `WowItem` cadastrado, mais frequente primeiro. */
  itemIds: Array<{ itemId: number; ocorrencias: number }>;
}

/** Uma linha crua: o que os dois repositórios de origem devolvem em comum. */
interface LinhaComItemString {
  itemId: number;
  itemString: string;
}

/**
 * "O que ainda não conhecemos" — TIT-82.
 *
 * Consulta sobre dado que JÁ TEMOS GUARDADO: varre `LootLine` e
 * `LootSessionItem`, extrai o que falta no dicionário de bonus e no catálogo
 * de itens, ordenado por frequência. Transforma "a exibição está incompleta"
 * em lista de trabalho priorizada — Regra 7.
 */
@Injectable()
export class WowBonusReportService {
  constructor(
    private readonly bonuses: WowBonusRepository,
    private readonly lootLines: LootLinesService,
    private readonly lootSessions: LootSessionsService,
    private readonly catalog: LootCatalogRepository,
  ) {}

  /** Lê as duas fontes, gera as duas listas. Cada uma tem o executor dela. */
  async gerar(): Promise<RelatorioDeDesconhecidos> {
    const [doHistorico, dasSessoes, idsConhecidos] = await Promise.all([
      this.lootLines.listarItensParaRelatorioDeBonus(),
      this.lootSessions.listarItensParaRelatorioDeBonus(),
      this.bonuses.findAllIds(),
    ]);

    const linhas = [...doHistorico, ...dasSessoes];

    return {
      bonusIds: this.bonusDesconhecidos(linhas, idsConhecidos),
      itemIds: await this.itensNaoCatalogados(linhas),
    };
  }

  /** Bonus IDs que aparecem nas linhas e não estão no dicionário, por frequência. */
  private bonusDesconhecidos(
    linhas: LinhaComItemString[],
    idsConhecidos: Set<number>,
  ): Array<{ bonusId: number; ocorrencias: number }> {
    const frequencia = new Map<number, number>();

    for (const linha of linhas) {
      const lido = parseItemString(linha.itemString);
      if (!lido) continue;

      for (const bonusId of lido.bonusIds) {
        if (idsConhecidos.has(bonusId)) continue;
        frequencia.set(bonusId, (frequencia.get(bonusId) ?? 0) + 1);
      }
    }

    return ordenarPorFrequencia(frequencia).map(([bonusId, ocorrencias]) => ({
      bonusId,
      ocorrencias,
    }));
  }

  /** `itemId` que aparece nas linhas e não tem `WowItem`, por frequência. */
  private async itensNaoCatalogados(
    linhas: LinhaComItemString[],
  ): Promise<Array<{ itemId: number; ocorrencias: number }>> {
    const frequencia = new Map<number, number>();
    for (const linha of linhas) {
      frequencia.set(linha.itemId, (frequencia.get(linha.itemId) ?? 0) + 1);
    }

    const catalogados = new Set(await this.catalog.findExistingItemIds([...frequencia.keys()]));
    for (const itemId of catalogados) frequencia.delete(itemId);

    return ordenarPorFrequencia(frequencia).map(([itemId, ocorrencias]) => ({
      itemId,
      ocorrencias,
    }));
  }
}

/** Mais frequente primeiro. Empate mantém a ordem em que o `Map` já trazia. */
function ordenarPorFrequencia(frequencia: Map<number, number>): Array<[number, number]> {
  return [...frequencia.entries()].sort((a, b) => b[1] - a[1]);
}
