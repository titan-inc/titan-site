/**
 * `random_suffix_type()` do SimC — a classe de orçamento (`idx`) e o
 * multiplicador (`tipo`) de um item, pelo slot. Ver "idx — a classe de
 * orçamento" e "tipo — o multiplicador" em `docs/db2-do-cliente.md`.
 *
 * As DUAS tabelas são só função de `InventoryType` — o enum padrão do WoW,
 * confirmado pela seção "Qual das quatro tabelas de dano" da doc (que já usa
 * os mesmos números: 17 = 2H, 13/21/22 = 1H).
 */
export type TipoOrcamento = 'armor' | 'weapon' | 'trinket' | 'jewelry';

const INV_HEAD = 1;
const INV_NECK = 2;
const INV_SHOULDER = 3;
const INV_CHEST = 5;
const INV_WAIST = 6;
const INV_LEGS = 7;
const INV_FEET = 8;
const INV_WRIST = 9;
const INV_HANDS = 10;
const INV_FINGER = 11;
const INV_TRINKET = 12;
const INV_WEAPON_1H = 13;
const INV_SHIELD = 14;
const INV_RANGED = 15;
const INV_CLOAK = 16;
const INV_WEAPON_2H = 17;
const INV_ROBE = 20;
const INV_WEAPON_MAINHAND = 21;
const INV_WEAPON_OFFHAND = 22;
const INV_HOLDABLE = 23;
const INV_THROWN = 25;
const INV_RANGED_RIGHT = 26;

/** idx 0: arma de duas mãos (e à distância) + peças "grandes" de armadura. */
const IDX0 = new Set([
  INV_WEAPON_2H,
  INV_RANGED,
  INV_RANGED_RIGHT,
  INV_HEAD,
  INV_CHEST,
  INV_LEGS,
  INV_ROBE,
]);
/** idx 1: ombro, cintura, pés, mãos, trinket. */
const IDX1 = new Set([INV_SHOULDER, INV_WAIST, INV_FEET, INV_HANDS, INV_TRINKET]);
/** idx 2: pescoço, dedo, capa, pulso. */
const IDX2 = new Set([INV_NECK, INV_FINGER, INV_CLOAK, INV_WRIST]);
/** idx 3: arma de uma mão, offhand, item de mão, escudo. */
const IDX3 = new Set([
  INV_WEAPON_1H,
  INV_WEAPON_MAINHAND,
  INV_WEAPON_OFFHAND,
  INV_HOLDABLE,
  INV_SHIELD,
]);

/** Slots que contam como "arma" para o multiplicador — inclui o escudo, que
 * segue a mesma coluna Weapon do CombatRatingsMultByILvl (não Armor). */
const SLOTS_ARMA = new Set([
  INV_WEAPON_1H,
  INV_WEAPON_2H,
  INV_WEAPON_MAINHAND,
  INV_WEAPON_OFFHAND,
  INV_RANGED,
  INV_RANGED_RIGHT,
  INV_THROWN,
  INV_SHIELD,
]);

export function resolverBudgetIndex(inventoryType: number): number {
  if (IDX0.has(inventoryType)) return 0;
  if (IDX1.has(inventoryType)) return 1;
  if (IDX2.has(inventoryType)) return 2;
  if (IDX3.has(inventoryType)) return 3;
  throw new Error(
    `InventoryType ${inventoryType} sem idx de orçamento conhecido — ver docs/db2-do-cliente.md`,
  );
}

export function resolverTipoOrcamento(inventoryType: number): TipoOrcamento {
  if (inventoryType === INV_NECK || inventoryType === INV_FINGER) return 'jewelry';
  if (inventoryType === INV_TRINKET) return 'trinket';
  if (SLOTS_ARMA.has(inventoryType)) return 'weapon';
  return 'armor';
}
