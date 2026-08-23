import { Injectable } from '@nestjs/common';
import {
  computeItemStats,
  itemStatsIndisponivel,
  parseItemString,
  ITEM_STATS_INDISPONIVEL,
  type ComputedItemStats,
  type DecodedBonuses,
  type ItemStringLido,
  type WowItemDataFacets,
  type WowItemSetFacets,
} from '@titan/shared';
import { decodeBonuses } from './wow-data-decoder';
import { chaveContexto, WowDataRepository } from './wow-data.repository';

/** O que a onda 1 apura, pronto para a onda 2 consumir — sem reconsultar
 * `itensPorId`, que a onda 1 já buscou. */
interface Onda1 {
  itens: Map<number, WowItemDataFacets>;
  decodedPorItemString: Map<string, DecodedBonuses>;
}

/**
 * O payload do tooltip de item — TIT-136, a peça que faltava antes do
 * popover (TIT-135). Orquestra o que `WowDataRepository` lê e entrega ao
 * `computeItemStats` (função pura, `@titan/shared`) o que ele pede.
 *
 * Sem controller próprio, mesmo desenho do `WowDataService`: quem chama é a
 * TIT-135, de dentro de outro módulo — ver o comentário no topo de
 * `wow-item-stats.module.ts`.
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
   *
   * Delega para `calcularVarios` com um elemento só — é este método que os
   * testes de `wow-item-stats.e2e-spec.ts` (TIT-136) provam contra o banco,
   * e essa prova não se reescreve.
   */
  async calcular(itemString: string): Promise<ComputedItemStats> {
    const resultado = await this.calcularVarios([itemString]);
    // `calcularVarios` sempre grava uma entrada para todo `itemString` de
    // entrada — inclusive as lacunas (string inválida, sem build). O `!` é
    // seguro por construção, não por sorte.
    return resultado.get(itemString)!;
  }

  /**
   * `MAX(WowBonus.trackScalingId)` do build ativo — TIT-135. Só entrega o
   * número; comparar com `DecodedTrack.scalingId` para decidir se a
   * contagem `4/6` aparece é de quem RENDERIZA (ver o comentário de
   * `WowDataRepository.trackScalingIdAtual`), nunca deste service.
   *
   * `null` sem build ativo (mesma lacuna de `calcular`) ou quando o build
   * não tem nenhum bonus com track.
   */
  async trackScalingIdAtual(): Promise<number | null> {
    const buildAtivo = await this.repo.buildAtivo();
    if (buildAtivo === null) return null;
    return this.repo.trackScalingIdAtual(buildAtivo);
  }

  /**
   * A mesma coisa que `calcular`, para VÁRIOS `itemString` de uma vez —
   * TIT-135. Uma página de histórico com 200 linhas não pode virar ~1.200
   * round trips: seis leituras por item, todas singulares, numa instância de
   * 1GB com Postgres do lado.
   *
   * DUAS ONDAS, não uma — tentar resolver numa passada só não funciona,
   * porque a onda 2 depende do que a onda 1 decodifica:
   *
   * ```
   * onda 1:  buildAtivo + itensPorId + contextosDeBonusDeVarios + facetasDeBonus
   *          (a união de bônus de TODOS os itens de uma vez, decodificada)
   * onda 2:  só agora se sabem os ilvls e os itemSetId de cada item
   *          → escalasPorItemLevel + setsPorId
   * ```
   *
   * A chave do `Map` de saída é o `itemString`, nunca o `itemId`: duas
   * cópias do mesmo item com `itemString` diferente (contexto, terciário,
   * nível de upgrade) são peças diferentes e têm que sair com resultados
   * diferentes — é a premissa que justifica guardar o `itemString` na Regra
   * 1 do payload.
   */
  async calcularVarios(itemStrings: string[]): Promise<Map<string, ComputedItemStats>> {
    const resultado = new Map<string, ComputedItemStats>();

    // `itemString` repetido na entrada (mesma peça, duas linhas da mesma
    // sessão) calcula uma vez só — o `Map` de saída responde pelas duas.
    const unicos = [...new Set(itemStrings)];

    const lidos = new Map<string, ItemStringLido>();
    for (const itemString of unicos) {
      const lido = parseItemString(itemString);
      if (!lido) {
        resultado.set(itemString, itemStatsIndisponivel(ITEM_STATS_INDISPONIVEL.ITEM_STRING_INVALIDO));
        continue;
      }
      lidos.set(itemString, lido);
    }
    if (lidos.size === 0) return resultado;

    // SEM BUILD ATIVO A GENTE NÃO SABE NADA — mesma resposta do
    // `WowDataService.decodificar`: lacuna honesta, nunca um número
    // inventado. `desconhecidos` recebe os bonusIds explícitos que já temos
    // em mãos — mesmo comportamento de `decodificar`, "todo bonus vira
    // desconhecido".
    const buildAtivo = await this.repo.buildAtivo();
    if (buildAtivo === null) {
      for (const [itemString, lido] of lidos) {
        resultado.set(
          itemString,
          itemStatsIndisponivel(ITEM_STATS_INDISPONIVEL.SEM_BUILD_ATIVO, {
            flavor: null,
            itemLevel: null,
            track: null,
            dificuldade: null,
            sockets: 0,
            desconhecidos: lido.bonusIds,
          }),
        );
      }
      return resultado;
    }

    const onda1 = await this.decodificarOnda1(buildAtivo, lidos, resultado);
    await this.calcularOnda2(buildAtivo, lidos, onda1, resultado);

    return resultado;
  }

  /**
   * Onda 1: o item e a união de bônus de TODOS os `itemString` válidos, numa
   * tacada só. Marca `ITEM_FORA_DO_BUILD` em `resultado` para quem não tem
   * `WowItemData` — essas entradas ficam de fora do que a onda 2 processa.
   */
  private async decodificarOnda1(
    buildId: string,
    lidos: Map<string, ItemStringLido>,
    resultado: Map<string, ComputedItemStats>,
  ): Promise<Onda1> {
    const itemIds = [...new Set([...lidos.values()].map((l) => l.itemId))];
    const itens = await this.repo.itensPorId(buildId, itemIds);

    const pares = [...lidos.values()]
      .filter((l) => l.itemContext !== null)
      .map((l) => ({ itemId: l.itemId, itemContext: l.itemContext! }));
    // Nenhum itemString do lote tem itemContext: não há árvore a consultar,
    // e não vale nem chamar o repositório — mesma garantia do singular
    // ("itemContext ausente não consulta a árvore").
    const contextos =
      pares.length === 0 ? new Map<string, number[]>() : await this.repo.contextosDeBonusDeVarios(buildId, pares);

    // A união POR ITEM, na mesma ordem árvore-antes-do-explícito que o
    // `calcular` singular usava (`uniaoDeBonus`) — colapsar tudo num `Set`
    // global perderia a ordem por item, que é o que decide o `Bellamy's
    // Final Judgement` (ver o comentário de `computeItemStats`).
    const uniaoPorItemString = new Map<string, number[]>();
    for (const [itemString, lido] of lidos) {
      const daArvore =
        lido.itemContext === null
          ? []
          : (contextos.get(chaveContexto(lido.itemId, lido.itemContext)) ?? []);
      uniaoPorItemString.set(itemString, [...new Set([...daArvore, ...lido.bonusIds])]);
    }

    const todosBonusIds = [...new Set([...uniaoPorItemString.values()].flat())];
    const facetas = await this.repo.facetasDeBonus(buildId, todosBonusIds);
    const dicionario = new Map(facetas.map((f) => [f.bonusId, f]));

    const decodedPorItemString = new Map<string, DecodedBonuses>();
    for (const [itemString, lido] of lidos) {
      if (!itens.has(lido.itemId)) {
        resultado.set(itemString, itemStatsIndisponivel(ITEM_STATS_INDISPONIVEL.ITEM_FORA_DO_BUILD));
        continue;
      }
      decodedPorItemString.set(itemString, decodeBonuses(uniaoPorItemString.get(itemString)!, dicionario));
    }

    return { itens, decodedPorItemString };
  }

  /**
   * Onda 2: agora que cada item foi decodificado, dá pra saber o ilvl
   * efetivo e o `itemSetId` de cada um — o que faltava para buscar escala e
   * conjunto em lote. `itens` vem pronto da onda 1, sem reconsultar.
   */
  private async calcularOnda2(
    buildId: string,
    lidos: Map<string, ItemStringLido>,
    { itens, decodedPorItemString }: Onda1,
    resultado: Map<string, ComputedItemStats>,
  ): Promise<void> {
    const itemDe = (itemString: string): WowItemDataFacets => itens.get(lidos.get(itemString)!.itemId)!;

    const ilvlPorItemString = new Map<string, number>();
    for (const [itemString, decoded] of decodedPorItemString) {
      ilvlPorItemString.set(itemString, decoded.itemLevel ?? itemDe(itemString).itemLevel);
    }

    const itemSetIds = [
      ...new Set(
        [...decodedPorItemString.keys()]
          .map((itemString) => itemDe(itemString).itemSetId)
          .filter((id): id is number => id !== null),
      ),
    ];

    const [escalas, sets] = await Promise.all([
      this.repo.escalasPorItemLevel(buildId, [...new Set(ilvlPorItemString.values())]),
      // Nenhum item do lote aponta pra um conjunto: não vale chamar o
      // repositório — mesma garantia do singular ("busca o conjunto só
      // quando o item aponta pra um").
      itemSetIds.length === 0
        ? Promise.resolve(new Map<number, WowItemSetFacets>())
        : this.repo.setsPorId(buildId, itemSetIds),
    ]);

    for (const [itemString, decoded] of decodedPorItemString) {
      const item = itemDe(itemString);
      const escala = escalas.get(ilvlPorItemString.get(itemString)!) ?? null;
      const set = item.itemSetId === null ? null : (sets.get(item.itemSetId) ?? null);
      resultado.set(itemString, computeItemStats(item, decoded, escala, set));
    }
  }
}
