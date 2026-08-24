import { Injectable } from '@nestjs/common';
import { parseItemString } from '@titan/shared';
import { LootCatalogRepository } from '../loot-catalog/loot-catalog.repository';
import { LootLinesService } from '../loot-lines/loot-lines.service';
import { LootSessionsService } from '../loot-sessions/loot-sessions.service';
import { WowDataRepository } from './wow-data.repository';

export interface RelatorioDeDesconhecidos {
  /**
   * O build contra o qual este relatório rodou — o parâmetro `build`, ou o
   * ativo quando ele não vem. `null` só no estado antes da primeira carga.
   */
  build: string | null;
  /** Bonus IDs fora do dicionário, mais frequente primeiro. */
  bonusIds: Array<{ bonusId: number; ocorrencias: number }>;
  /** `itemId` sem `WowItem` cadastrado, mais frequente primeiro. */
  itemIds: Array<{ itemId: number; ocorrencias: number }>;
  /**
   * `itemId` cadastrado no catálogo mas SEM `WowItemData` no build
   * conferido — TIT-136 precisa saber disso antes de ativar um PTR.
   *
   * Pergunta diferente de `itemIds`: aquela é falha de CATALOGAÇÃO (item no
   * histórico que ninguém cadastrou); esta é falha de CARGA (item que a
   * liderança já cadastrou, mas o build não trouxe dado nenhum dele — patch
   * que removeu o item, ou catálogo na frente do build carregado).
   */
  itensSemDadoNoBuild: number[];
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
export class WowDataReportService {
  constructor(
    private readonly dados: WowDataRepository,
    private readonly lootLines: LootLinesService,
    private readonly lootSessions: LootSessionsService,
    private readonly catalog: LootCatalogRepository,
  ) {}

  /**
   * Lê as fontes, gera as três listas. Cada uma tem o executor dela.
   *
   * `build` deixa conferir um build que ainda não foi ativado — o PTR antes
   * da virada (TIT-140). Omitido, cai no ativo; sem ativo nenhum, vira o
   * mesmo estado de "nada conhecido" de antes da primeira carga.
   */
  async gerar(build?: string): Promise<RelatorioDeDesconhecidos> {
    const buildAlvo = build ?? (await this.dados.buildAtivo());

    const [doHistorico, dasSessoes, idsBonusConhecidos, idsItemComDado, itemIdsCatalogados] =
      await Promise.all([
        this.lootLines.listarItensParaRelatorioDeBonus(),
        this.lootSessions.listarItensParaRelatorioDeBonus(),
        // SEM BUILD PARA CONFERIR, NADA É CONHECIDO — e o relatório dizendo
        // "todos desconhecidos" é a resposta certa, não um caso de borda a
        // esconder. É exatamente o que se quer ver antes da primeira carga.
        buildAlvo === null
          ? Promise.resolve(new Set<number>())
          : this.dados.idsDeBonusConhecidos(buildAlvo),
        buildAlvo === null
          ? Promise.resolve(new Set<number>())
          : this.dados.idsDeItemNoBuild(buildAlvo),
        this.catalog.findAllItemIds(),
      ]);

    const linhas = [...doHistorico, ...dasSessoes];

    return {
      build: buildAlvo,
      bonusIds: this.bonusDesconhecidos(linhas, idsBonusConhecidos),
      itemIds: await this.itensNaoCatalogados(linhas),
      itensSemDadoNoBuild: itemIdsCatalogados
        .filter((itemId) => !idsItemComDado.has(itemId))
        .sort((a, b) => a - b),
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
