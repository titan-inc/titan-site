import type { ResultadoResolucaoBonus } from './resolucao-bonus.js';
import type { ItemSparseResumo, Descritor, StatAdicional } from './carregadores.js';
import type { ArmorLocationLinha } from './formula-armadura-arma.js';
import type { ResolvedorItemLevel } from './item-level.js';
import type { ResolvedorTrack } from './formula-track.js';
import type { ResolvedorEfeito } from './formula-efeito.js';
import { resolverBudgetIndex, resolverTipoOrcamento } from './orcamento.js';
import { COLS_ITEM, COLS_BONUS, COLS_CONTEXT } from '../../packages/shared/dist/index.mjs';

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
      budgetIndex,
      scalingType,
      armorModifier,
      efeito === null ? null : efeito,
    ]);
  }

  return { tabela: { cols: COLS_ITEM, rows }, itemIdsSemDado };
}

/** `ArmorLocation[slot][material]` — só o modificador, não a armadura
 * inteira (que depende do ilvl do drop, resolvido em runtime). */
function calcularArmorModifier(
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

const STAT_ID_PARA_TERCIARIO: Record<number, 'avoidance' | 'leech' | 'speed' | 'indestructible'> = {
  63: 'avoidance',
  62: 'leech',
  61: 'speed',
  64: 'indestructible',
};

/**
 * `bonuses` (`WowBonus`) — uma linha por bonusId ALCANÇADO pela árvore de
 * QUALQUER item do catálogo (`resolucao-bonus.ts`), nunca "só os que
 * apareceram num itemString real" — é essa mudança que faz a season nova
 * funcionar sozinha na terça-feira (ver a issue).
 */
export function montarBonuses(bonusIds: Set<number>, fontes: FontesBonus): TabelaColunar {
  const rows: unknown[][] = [];

  for (const bonusId of bonusIds) {
    const track = fontes.trackResolver.resolver(bonusId);
    const itemLevel = fontes.itemLevelResolver.resolver(bonusId);
    const tercEntrada = (fontes.statsExtrasPorBonus.get(bonusId) ?? []).find(
      (e) => e.statId in STAT_ID_PARA_TERCIARIO,
    );
    const descritor = fontes.descritorPorBonus.get(bonusId);

    rows.push([
      bonusId,
      track?.nome ?? null,
      track?.rank ?? null,
      track?.total ?? null,
      track?.scalingId ?? null,
      itemLevel,
      tercEntrada ? STAT_ID_PARA_TERCIARIO[tercEntrada.statId] : null,
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
