import { Injectable } from '@nestjs/common';
import {
  computeItemStats,
  itemStatsIndisponivel,
  parseItemString,
  ITEM_STATS_INDISPONIVEL,
  type ComputedItemStats,
  type ItemStringLido,
} from '@titan/shared';
import { decodeBonuses } from './wow-data-decoder';
import { WowDataRepository } from './wow-data.repository';

/**
 * O payload do tooltip de item — TIT-136, a peça que faltava antes do
 * popover (TIT-135). Orquestra o que `WowDataRepository` lê e entrega ao
 * `computeItemStats` (função pura, `@titan/shared`) o que ele pede.
 *
 * Sem controller próprio, mesmo desenho do `WowDataService`: quem chama é a
 * TIT-135, de dentro de outro módulo — ver o comentário no topo de
 * `wow-data.module.ts`.
 */
@Injectable()
export class WowItemStatsService {
  constructor(private readonly repo: WowDataRepository) {}

  /**
   * `itemString` → o payload inteiro. Cada passo espelha a união descrita na
   * TIT-136 e na implementação de referência (`scripts/db2/auto-conferencia.ts`):
   *
   * ```
   * itemString  →  itemId, itemContext, bonusIds explícitos
   * bônus       =  bonusIds  ∪  WowItemContextBonus[buildAtivo][itemId][itemContext]
   * facetas     =  WowBonus[buildAtivo][cada bonus]
   * ilvl        =  escolherItemLevel(facetas) ?? WowItemData.itemLevel
   * escala      =  WowItemLevelScaling[buildAtivo][ilvl]
   * números     =  fórmula( WowItemData, escala, statsAdicionados )
   * ```
   */
  async calcular(itemString: string): Promise<ComputedItemStats> {
    const lido = parseItemString(itemString);
    if (!lido) return itemStatsIndisponivel(ITEM_STATS_INDISPONIVEL.ITEM_STRING_INVALIDO);

    // SEM BUILD ATIVO A GENTE NÃO SABE NADA — mesma resposta do
    // `WowDataService.decodificar`: lacuna honesta, nunca um número
    // inventado. É o estado em que o banco nasce, antes da primeira carga.
    const buildAtivo = await this.repo.buildAtivo();
    if (buildAtivo === null) {
      return itemStatsIndisponivel(ITEM_STATS_INDISPONIVEL.SEM_BUILD_ATIVO);
    }

    const item = await this.repo.itemPorId(buildAtivo, lido.itemId);
    if (item === null) {
      return itemStatsIndisponivel(ITEM_STATS_INDISPONIVEL.ITEM_FORA_DO_BUILD);
    }

    const bonusIds = await this.uniaoDeBonus(buildAtivo, lido);
    const facetas = await this.repo.facetasDeBonus(buildAtivo, bonusIds);
    const decoded = decodeBonuses(bonusIds, new Map(facetas.map((f) => [f.bonusId, f])));

    const ilvl = decoded.itemLevel ?? item.itemLevel;
    const [escala, set] = await Promise.all([
      this.repo.escalaPorItemLevel(buildAtivo, ilvl),
      item.itemSetId === null ? null : this.repo.setPorId(buildAtivo, item.itemSetId),
    ]);

    return computeItemStats(item, decoded, escala, set);
  }

  /**
   * A ÁRVORE primeiro, os bonus EXPLÍCITOS do `itemString` por último — a
   * metade que só existe em runtime, porque o gerador nunca vê um drop
   * real. Ver "O `itemString` NÃO é a fonte completa" em
   * `docs/db2-do-cliente.md`.
   *
   * **A ORDEM importa, e não é estética.** `decodeBonuses` resolve empate
   * de marcador igual (`escolherItemLevel`) e as demais facetas escalares
   * (track/binding/dificuldade) por "o último da lista vence". Provado
   * contra o banco no `Bellamy's Final Judgement` (249277): a árvore dá
   * `12801` (`Myth 1/6`, ilvl 272, marcador 0) e o `itemString` traz
   * explícito `13654` (`Ascendant Voidforged: Myth`, ilvl 298, TAMBÉM
   * marcador 0) — os dois "confiáveis" ao mesmo tempo. O tooltip mostra
   * 298: o mecanismo de season, decidido NA HORA DO DROP, tem que vencer o
   * baseline genérico da árvore. Union explícito-primeiro (a ordem que
   * `scripts/db2/auto-conferencia.ts` usa) resolveria isso do jeito
   * OPOSTO, porque lá quem não sobrescreve em empate é o PRIMEIRO — a
   * mesma prioridade, expressa como a regra inversa.
   *
   * `itemContext` nulo (campo ausente no `itemString`) significa "não sei
   * de onde a peça veio" — sem ele não dá pra consultar a árvore, e a união
   * fica só com o que o `itemString` já trazia explícito.
   */
  private async uniaoDeBonus(buildId: string, lido: ItemStringLido): Promise<number[]> {
    if (lido.itemContext === null) return lido.bonusIds;

    const daArvore = await this.repo.contextosDeBonus(buildId, lido.itemId, lido.itemContext);
    return [...new Set([...daArvore, ...lido.bonusIds])];
  }
}
