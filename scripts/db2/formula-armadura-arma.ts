/**
 * Armadura, `Block` e dano de arma — ver "Armadura" e "Arma" em
 * `docs/db2-do-cliente.md`.
 *
 * ```
 * armadura = floor( ItemArmorTotal[ilvl][material] × ItemArmorQuality[ilvl][qual]
 *                   × ArmorLocation[slot][material] + 0,5 )
 *
 * escudo:  armadura = floor( ItemArmorShield[ilvl].Quality[qual] + 0,5 )
 *          Block    = floor( ItemArmorShield[ilvl].Quality[qual] × 2,5 )
 *
 * dpsTabela = ItemDamage{OneHand|TwoHand}[Caster][ilvl].Quality[qual]
 * speed     = ItemSparse.ItemDelay / 1000
 * min       = floor( dpsTabela × speed × (1 − DmgVariance/2) )
 * max       = floor( dpsTabela × speed × (1 + DmgVariance/2) + 0,5 )
 * dpsExibido = arredonda1casa( (min + max) / 2 / speed )
 * ```
 */
import type { LinhaEscala } from './montar-escalas.js';

const INV_HEAD = 1;
const INV_SHOULDER = 3;
const INV_CHEST = 5;
const INV_WAIST = 6;
const INV_LEGS = 7;
const INV_WRIST = 9;
const INV_HANDS = 10;
const INV_FEET = 8;
const INV_CLOAK = 16;
const INV_WEAPON_1H = 13;
const INV_SHIELD = 14;
const INV_WEAPON_2H = 17;
const INV_ROBE = 20;
const INV_WEAPON_MAINHAND = 21;
const INV_WEAPON_OFFHAND = 22;

/** `Item.SubclassID` → índice de coluna do `ArmorLocation`/`ItemArmorTotal`
 * (0 = sem armadura innata — token, joia, arma). */
export function resolverMaterial(itemSubclassId: number): number {
  if (itemSubclassId >= 1 && itemSubclassId <= 4) return itemSubclassId;
  return 0;
}

const SLOTS_COM_ARMOR_LOCATION = new Set([
  INV_HEAD,
  INV_SHOULDER,
  INV_CHEST,
  INV_WAIST,
  INV_LEGS,
  INV_FEET,
  INV_WRIST,
  INV_HANDS,
  INV_CLOAK,
  INV_ROBE,
]);

/** As quatro colunas de material do `ArmorLocation`, na ordem 1..4 — a 5ª
 * coluna (`Modifier`) NÃO entra (ver "A quinta coluna do ArmorLocation" na doc). */
function colunaArmorLocation(
  material: number,
): 'clothmodifier' | 'leathermodifier' | 'chainmodifier' | 'platemodifier' {
  return (['clothmodifier', 'leathermodifier', 'chainmodifier', 'platemodifier'] as const)[
    material - 1
  ]!;
}

export interface ArmorLocationLinha {
  clothmodifier: number;
  leathermodifier: number;
  chainmodifier: number;
  platemodifier: number;
}

/**
 * `null` quando o item não tem armadura innata: material 0 (token/joia/arma)
 * ou slot fora do `ArmorLocation` (ex. trinket, dedo, pescoço).
 */
export function calcularArmadura(
  material: number,
  inventoryType: number,
  qualidade: number,
  escala: LinhaEscala,
  armorLocationPorSlot: Map<number, ArmorLocationLinha>,
): number | null {
  if (inventoryType === INV_SHIELD) {
    return Math.floor((escala.armorShield[qualidade] ?? 0) + 0.5);
  }
  if (material === 0 || !SLOTS_COM_ARMOR_LOCATION.has(inventoryType)) return null;

  const armorLocation = armorLocationPorSlot.get(inventoryType);
  if (!armorLocation) return null;

  const total = escala.armorTotal[material - 1] ?? 0;
  const qualityMod = escala.armorQuality[qualidade] ?? 0;
  const slotMod = armorLocation[colunaArmorLocation(material)];

  return Math.floor(total * qualityMod * slotMod + 0.5);
}

export function calcularBlock(qualidade: number, escala: LinhaEscala): number {
  return Math.floor((escala.armorShield[qualidade] ?? 0) * 2.5);
}

export type TabelaDano = 'dmgOneHand' | 'dmgTwoHand' | 'dmgOneHandCaster' | 'dmgTwoHandCaster';

const BIT_CASTER_WEAPON = 0x200;

/** Qual das quatro tabelas de dano — `InventoryType` + o bit de caster no
 * SEGUNDO elemento do `Flags` (ver "Qual das quatro tabelas de dano"). */
export function resolverTabelaDano(inventoryType: number, flags: number[]): TabelaDano | null {
  const ehCaster = ((flags[1] ?? 0) & BIT_CASTER_WEAPON) !== 0;
  if (inventoryType === INV_WEAPON_2H) return ehCaster ? 'dmgTwoHandCaster' : 'dmgTwoHand';
  if (
    inventoryType === INV_WEAPON_1H ||
    inventoryType === INV_WEAPON_MAINHAND ||
    inventoryType === INV_WEAPON_OFFHAND
  ) {
    return ehCaster ? 'dmgOneHandCaster' : 'dmgOneHand';
  }
  return null;
}

export interface DanoDeArma {
  min: number;
  max: number;
  dps: number;
}

export function calcularDanoDeArma(
  tabela: TabelaDano,
  qualidade: number,
  itemDelayMs: number,
  dmgVariance: number,
  escala: LinhaEscala,
): DanoDeArma {
  const dpsTabela = escala[tabela][qualidade] ?? 0;
  const speed = itemDelayMs / 1000;

  const min = Math.floor(dpsTabela * speed * (1 - dmgVariance / 2));
  const max = Math.floor(dpsTabela * speed * (1 + dmgVariance / 2) + 0.5);
  const dps = arredonda1Casa((min + max) / 2 / speed);

  return { min, max, dps };
}

function arredonda1Casa(x: number): number {
  return Math.round(x * 10) / 10;
}
