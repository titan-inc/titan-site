import type { ResultadoResolucaoBonus } from './resolucao-bonus.js';
import type {
  ItemSparseResumo,
  Descritor,
  StatAdicional,
  ConjuntoDeItens,
  ArmorLocationLinha,
} from './carregadores.js';
import type { ResolvedorItemLevel } from './item-level.js';
import type { ResolvedorTrack } from './formula-track.js';
import type { ResolvedorEfeito } from './formula-efeito.js';
import {
  COLS_ITEM,
  COLS_BONUS,
  COLS_CONTEXT,
  COLS_SET,
  resolverBudgetIndex,
  resolverTipoOrcamento,
} from '../../packages/shared/dist/index.mjs';

export interface TabelaColunar {
  cols: readonly string[];
  rows: unknown[][];
}

/**
 * `itens` (`WowItemData`) — uma linha por item do CATÁLOGO que tem linha no
 * `ItemSparse`. Item catalogado sem `ItemSparse` é LACUNA (sai do arquivo,
 * entra no relatório) — nunca falha dura, porque a ausência é legítima
 * (patch não lançado, id de teste). Ver "O gerador NÃO emite WowItem" na
 * issue: aqui só entra o que já está no catálogo.
 */
export function montarItens(
  itemIds: number[],
  itemSparsePorId: Map<number, ItemSparseResumo>,
  materialPorItem: Map<number, number>,
  armorLocationPorSlot: Map<number, ArmorLocationLinha>,
  efeitoResolver: ResolvedorEfeito,
): { tabela: TabelaColunar; itemIdsSemDado: number[] } {
  const rows: unknown[][] = [];
  const itemIdsSemDado: number[] = [];

  for (const itemId of itemIds) {
    const item = itemSparsePorId.get(itemId);
    if (!item) {
      itemIdsSemDado.push(itemId);
      continue;
    }

    const material = materialPorItem.get(itemId) ?? 0;
    // Não-equipamento (InventoryType 0 — token, decor, cosmético) não usa
    // orçamento de stat nem multiplicador (ver "Eles NÃO são um modelo
    // separado" na doc: a resolução de bônus é igual, o orçamento não
    // existe). O schema exige os dois campos não-nulos; o valor é inerte
    // aqui porque o item não tem statIds pra formula nenhuma ler.
    const naoEquipamento = item.inventoryType === 0;
    const budgetIndex = naoEquipamento ? 0 : resolverBudgetIndex(item.inventoryType);
    const scalingType = naoEquipamento ? 'armor' : resolverTipoOrcamento(item.inventoryType);
    const armorModifier = calcularArmorModifier(material, item.inventoryType, armorLocationPorSlot);
    const efeito = efeitoResolver.resolverPorItem(itemId);

    rows.push([
      itemId,
      item.itemLevel,
      item.overallQualityId,
      item.inventoryType,
      material,
      item.bonding,
      item.flags,
      item.statIds,
      item.statAllocs,
      item.socketAllocs,
      item.itemDelay === 0 ? null : item.itemDelay,
      item.dmgVariance,
      item.flavor === '' ? null : item.flavor,
      item.nameDescriptionId === 0 ? null : item.nameDescriptionId,
      item.itemSet === 0 ? null : item.itemSet,
      budgetIndex,
      scalingType,
      armorModifier,
      efeito === null ? null : efeito,
    ]);
  }

  return { tabela: { cols: COLS_ITEM, rows }, itemIdsSemDado };
}

/**
 * `ArmorLocation[slot][material]` — só o modificador, não a armadura
 * inteira (que depende do ilvl do drop, resolvido em runtime).
 *
 * Exportada porque a auto-conferência (TIT-136) precisa do MESMO
 * modificador que vai pro `WowItemData.armorModifier`, pra chamar o
 * `calcularArmadura` migrado (que recebe o escalar já resolvido, não a
 * tabela `ArmorLocation` inteira) — duas contas separadas divergiriam em
 * silêncio no dia em que uma mudasse sem a outra.
 */
export function calcularArmorModifier(
  material: number,
  inventoryType: number,
  armorLocationPorSlot: Map<number, ArmorLocationLinha>,
): number | null {
  if (material === 0) return null;
  const linha = armorLocationPorSlot.get(inventoryType);
  if (!linha) return null;
  const colunas = [
    linha.clothmodifier,
    linha.leathermodifier,
    linha.chainmodifier,
    linha.platemodifier,
  ];
  return colunas[material - 1] ?? null;
}

export interface FontesBonus {
  itemLevelResolver: ResolvedorItemLevel;
  trackResolver: ResolvedorTrack;
  statsExtrasPorBonus: Map<number, StatAdicional[]>;
  qualidadeExtraPorBonus: Map<number, number>;
  bonusComSocket: Set<number>;
  bindingPorBonus: Map<number, 'warbound_until_equipped'>;
  descritorPorBonus: Map<number, Descritor>;
}

/**
 * `bonuses` (`WowBonus`) — uma linha por bonusId que existe no `ItemBonus`
 * DESTE BUILD, não só os alcançados pela árvore de algum item do catálogo.
 *
 * A árvore (`resolucao-bonus.ts`) responde "que bônus este item pode
 * assumir por contexto" — é uma resposta MENOR que "que bônus pode aparecer
 * num itemString real". Um modificador atribuído no sorteio do drop nunca
 * passa por nó de árvore nem por entrada de grupo, e ainda assim aparece no
 * `itemString`. Ver `carregarTodosBonusIds` em `carregadores.ts` pra a
 * evidência (o escudo da fixture é um dos casos).
 */
export function montarBonuses(bonusIds: Set<number>, fontes: FontesBonus): TabelaColunar {
  const rows: unknown[][] = [];

  for (const bonusId of bonusIds) {
    const track = fontes.trackResolver.resolver(bonusId);
    const ilvl = fontes.itemLevelResolver.resolverComConfianca(bonusId);
    const descritor = fontes.descritorPorBonus.get(bonusId);

    // TODOS os stats do `Type 2`, não só o terciário. Ele acrescenta
    // secundário muito mais do que terciário (Versatility em 468 listas,
    // Haste 372, contra 8 de cada terciário), e a versão anterior emitia só
    // um rótulo de terciário — perdendo o valor E todo o resto em silêncio.
    const stats = fontes.statsExtrasPorBonus.get(bonusId) ?? [];

    rows.push([
      bonusId,
      track?.nome ?? null,
      track?.rank ?? null,
      track?.total ?? null,
      track?.scalingId ?? null,
      ilvl?.ilvl ?? null,
      // O desempate, CRU: `0` vence quando duas listas do mesmo itemString
      // disputam o ilvl. Sem ele, o banco não distingue as duas.
      ilvl?.marcador ?? null,
      stats.map((e) => e.statId),
      stats.map((e) => e.alocacao),
      fontes.bonusComSocket.has(bonusId),
      fontes.bindingPorBonus.get(bonusId) ?? null,
      descritor?.texto ?? null,
      descritor?.cor ?? null,
      fontes.qualidadeExtraPorBonus.get(bonusId) ?? null,
    ]);
  }

  return { cols: COLS_BONUS, rows };
}

/**
 * `contextos` (`WowItemContextBonus`) — a árvore de bônus já resolvida,
 * pronta pro carregador gravar. `resolucao-bonus.ts` já fez a parte difícil
 * (descida incondicional, aplicação só em ctx != 0); aqui é achatar.
 */
export function montarContextos(
  contextosPorItem: ResultadoResolucaoBonus['contextosPorItem'],
): TabelaColunar {
  const rows: unknown[][] = [];
  for (const [itemId, porContexto] of contextosPorItem) {
    for (const [itemContext, bonusIds] of porContexto) {
      for (const bonusId of bonusIds) {
        rows.push([itemId, itemContext, bonusId]);
      }
    }
  }
  return { cols: COLS_CONTEXT, rows };
}

/**
 * `sets` (`WowItemSet`) — só os conjuntos que os itens do catálogo alcançam.
 *
 * O `bonuses` sai como JSON de `{ chrSpecId, threshold, spellId }`: é lista
 * particular do conjunto, não vira filtro nem coluna de relatório — mesma
 * régua do `effects` do item.
 */
export function montarSets(conjuntos: ConjuntoDeItens[]): TabelaColunar {
  return {
    cols: COLS_SET,
    rows: conjuntos.map((c) => [c.itemSetId, c.name, c.pieceItemIds, c.bonuses]),
  };
}
