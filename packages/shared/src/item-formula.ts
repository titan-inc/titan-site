import { z } from 'zod';
import { WOW_BONDINGS, type WowBonding } from './wow-bonus.js';

/**
 * "A fórmula" de `docs/db2-do-cliente.md` — TIT-139/TIT-141 verificaram cada
 * pedaço dela contra a fixture (208 valores, 0 divergências). Migrada aqui na
 * TIT-136 para que a auto-conferência do gerador (`scripts/db2`) e o
 * resolvedor de runtime (`apps/api`) rodem **o mesmo código**, não duas
 * cópias que podem divergir em silêncio — ver "A decisão que abre esta issue"
 * na TIT-136.
 *
 * O gerador lê db2 (SQLite) e monta estas mesmas formas antes de chamar as
 * funções daqui; o resolvedor de runtime lê Postgres e monta as mesmas
 * formas. Nenhuma das duas pontas faz conta — a conta mora só aqui.
 */

/* -------------------------------------------------------------------------- */
/* A escala por item level — o que WowItemLevelScaling guarda por build       */
/* -------------------------------------------------------------------------- */

/** `CombatRatingsMultByILvl`/`StaminaMultByILvl` — mesma forma nas duas. */
export interface MultiplicadorPorTipo {
  armor: number;
  weapon: number;
  trinket: number;
  jewelry: number;
}

/**
 * Uma linha de `WowItemLevelScaling` — colapsa onze tabelas db2 num ilvl só.
 * Mesma forma nos dois lados: o gerador monta a partir do dump (db2), o
 * resolvedor de runtime monta a partir da linha do Postgres.
 */
export interface LinhaEscala {
  itemLevel: number;
  /** `RandPropPoints.EpicF[0..4]` — a coluna FLOAT, nunca a `Epic` (INT). */
  budget: number[];
  damageReplaceStat: number;
  damageSecondary: number;
  crMult: MultiplicadorPorTipo;
  stamMult: MultiplicadorPorTipo;
  /** `ItemSocketCostPerLevel` — termo morto acima do ilvl 60. */
  socketCost: number;
  armorTotal: number[];
  armorQuality: number[];
  armorShield: number[];
  dmgOneHand: number[];
  dmgTwoHand: number[];
  dmgOneHandCaster: number[];
  dmgTwoHandCaster: number[];
}

/* -------------------------------------------------------------------------- */
/* Orçamento — random_suffix_type() do SimC                                   */
/* -------------------------------------------------------------------------- */

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
/** `InventoryType` do escudo — único slot cuja armadura/`Block` seguem tabela
 * própria (`ItemArmorShield`), em vez de `ItemArmorTotal`. Exportado porque
 * quem monta o payload precisa da mesma constante pra decidir a linha `block`. */
export const INV_SHIELD = 14;
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

/* -------------------------------------------------------------------------- */
/* Stat: valor de cada linha de secundário/primário/terciário                 */
/* -------------------------------------------------------------------------- */

/** Str(4), Agi(3), Int(5) fixos + os quatro ids de primário flexível (71-74). */
const IDS_PRIMARIOS = new Set([3, 4, 5, 71, 72, 73, 74]);
const ID_STAMINA = 7;

export function ehStatPrimario(statId: number): boolean {
  return IDS_PRIMARIOS.has(statId);
}

/**
 * ```
 * budget  = RandPropPoints[ilvl].EpicF[idx]        ← a coluna FLOAT, não a INT
 * penalty = round_banqueiro( StatPercentageOfSocket[i] × ItemSocketCostPerLevel[ilvl] )
 * cru     = StatPercentEditor[i] × budget × 0,0001 − penalty
 * se combat rating:  cru ×= CombatRatingsMultByILvl[ilvl][tipo]
 * senão se stamina:  cru ×= StaminaMultByILvl[ilvl][tipo]
 * valor   = round( cru )
 * ```
 *
 * **Primário não recebe multiplicador nenhum** — não é combat rating.
 */
export function calcularValorStat(
  statId: number,
  alocacao: number,
  alocacaoSocket: number,
  budgetIndex: number,
  tipoOrcamento: TipoOrcamento,
  escala: Pick<LinhaEscala, 'budget' | 'socketCost' | 'crMult' | 'stamMult'>,
): number {
  const budget = escala.budget[budgetIndex] ?? 0;
  const penalty = arredondamentoBanqueiro(alocacaoSocket * escala.socketCost);
  let cru = (alocacao * budget) / 10000 - penalty;

  if (statId === ID_STAMINA) {
    cru *= escala.stamMult[tipoOrcamento];
  } else if (!ehStatPrimario(statId)) {
    cru *= escala.crMult[tipoOrcamento];
  }
  // Primário: sem multiplicador.

  return Math.round(cru);
}

/**
 * Arredondamento bancário (half-to-even) — só usado no `penalty`, per a
 * fórmula do SimC. O `valor` final usa arredondamento normal (`Math.round`),
 * nunca truncamento.
 */
export function arredondamentoBanqueiro(x: number): number {
  const piso = Math.floor(x);
  const resto = x - piso;
  if (resto < 0.5) return piso;
  if (resto > 0.5) return piso + 1;
  return piso % 2 === 0 ? piso : piso + 1;
}

/* -------------------------------------------------------------------------- */
/* Armadura, Block e dano de arma                                             */
/* -------------------------------------------------------------------------- */

/** `Item.SubclassID` → índice de coluna do `ArmorLocation`/`ItemArmorTotal`
 * (0 = sem armadura inata — token, joia, arma). */
export function resolverMaterial(itemSubclassId: number): number {
  if (itemSubclassId >= 1 && itemSubclassId <= 4) return itemSubclassId;
  return 0;
}

/**
 * `null` quando o item não tem armadura inata: material 0 (token/joia/arma)
 * ou slot fora do `ArmorLocation` (ex. trinket, dedo, pescoço).
 *
 * `armorModifier` é `ArmorLocation[slot][material]`, JÁ RESOLVIDO —
 * `WowItemData.armorModifier`. Não recebe a tabela `ArmorLocation` inteira
 * (23 linhas) nem o `inventoryType` pra escolher a coluna: essa escolha é
 * **derivada pelo gerador**, nunca recalculada aqui — ver o comentário de
 * `WowItemData.armorModifier` no schema. O resolvedor de runtime só tem o
 * escalar; não tem (nem precisa d)a tabela.
 */
export function calcularArmadura(
  material: number,
  inventoryType: number,
  qualidade: number,
  escala: Pick<LinhaEscala, 'armorShield' | 'armorTotal' | 'armorQuality'>,
  armorModifier: number | null,
): number | null {
  if (inventoryType === INV_SHIELD) {
    return Math.floor((escala.armorShield[qualidade] ?? 0) + 0.5);
  }
  if (material === 0 || armorModifier === null) return null;

  const total = escala.armorTotal[material - 1] ?? 0;
  const qualityMod = escala.armorQuality[qualidade] ?? 0;

  return Math.floor(total * qualityMod * armorModifier + 0.5);
}

export function calcularBlock(qualidade: number, escala: Pick<LinhaEscala, 'armorShield'>): number {
  return Math.floor((escala.armorShield[qualidade] ?? 0) * 2.5);
}

export type TabelaDano = 'dmgOneHand' | 'dmgTwoHand' | 'dmgOneHandCaster' | 'dmgTwoHandCaster';

const BIT_CASTER_WEAPON = 0x200;

/** Qual das quatro tabelas de dano — `InventoryType` + o bit de caster no
 * SEGUNDO elemento do `Flags`. */
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
  escala: Pick<LinhaEscala, TabelaDano>,
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

/* -------------------------------------------------------------------------- */
/* Texto de efeito (trinket, "Use:", "Equip:")                                */
/* -------------------------------------------------------------------------- */

export const spellEfeitoBrutoSchema = z.object({
  effectIndex: z.number().int(),
  coefficient: z.number(),
  scalingClass: z.number().int(),
});
export type SpellEfeitoBruto = z.infer<typeof spellEfeitoBrutoSchema>;

/**
 * O que `WowItemData.effects` guarda como JSON — a RECEITA do efeito, nunca o
 * valor final (que depende do ilvl do drop). `ItemXItemEffect → ItemEffect →
 * Spell.Description_lang`, com `$sN`/`$d`/`$u` como placeholder.
 */
export const efeitoDoItemSchema = z.object({
  spellId: z.number().int(),
  descricaoTemplate: z.string(),
  duracaoMs: z.number().nullable(),
  maxStacks: z.number().int().nullable(),
  efeitos: spellEfeitoBrutoSchema.array(),
});
export type EfeitoDoItem = z.infer<typeof efeitoDoItemSchema>;

/**
 * `escala(ScalingClass, ilvl)` — só o `EpicF[0]` está medido (o `−1` e o `−8`
 * dos espécimes verificados). Os outros ramos seguem a fórmula do SimC como
 * está escrita, sem espécime que os confirme.
 */
export function calcularEscalaDoEfeito(
  scalingClass: number,
  escala: Pick<LinhaEscala, 'damageReplaceStat' | 'damageSecondary' | 'budget'>,
): number {
  if (scalingClass === -8) return escala.damageReplaceStat;
  if (scalingClass === 0 || scalingClass === -9) return escala.damageSecondary;
  // −7 usaria CombatRatingsMultByILvl também, mas nenhum espécime distingue
  // qual coluna (armor/weapon/trinket/jewelry) — não exercitado, sem aposta.
  return escala.budget[0] ?? 0;
}

/**
 * `round`, não `floor` — dois exemplos verificados pareciam floor porque a
 * doc mostra o cru arredondado a 1 casa. Um segundo espécime (rank 2 do mesmo
 * trinket) desfez a ambiguidade: só `round` fecha os dois ranks ao mesmo tempo.
 */
export function calcularValorEfeito(
  coefficient: number,
  scalingClass: number,
  escala: Pick<LinhaEscala, 'damageReplaceStat' | 'damageSecondary' | 'budget'>,
): number {
  return Math.round(coefficient * calcularEscalaDoEfeito(scalingClass, escala));
}

/** Substitui `$sN`, `$d` (em segundos) e `$u` — os únicos placeholders com
 * fonte extraída. Outros (`$@spelldescN`, `$w1`...) ficam como estão. */
export function renderizarTexto(
  efeito: Pick<EfeitoDoItem, 'descricaoTemplate' | 'duracaoMs' | 'maxStacks'>,
  valoresPorIndice: Map<number, number>,
): string {
  let texto = efeito.descricaoTemplate;
  for (const [effectIndex, valor] of valoresPorIndice) {
    texto = texto.replaceAll(`$s${effectIndex + 1}`, String(valor));
  }
  if (efeito.duracaoMs !== null) {
    texto = texto.replaceAll('$d', `${efeito.duracaoMs / 1000} sec`);
  }
  if (efeito.maxStacks !== null) {
    texto = texto.replaceAll('$u', String(efeito.maxStacks));
  }
  return texto;
}

/* -------------------------------------------------------------------------- */
/* Vínculo — três estados, ver "Binds to Warband é flag" em db2-do-cliente.md */
/* -------------------------------------------------------------------------- */

/** Bit 27 (`ITEM_BIND_TO_ACCOUNT`) do PRIMEIRO elemento de `Flags`. */
const BIT_WARBAND = 1 << 27;

const BONDING_RAW_BIND_ON_PICKUP = 1;
const BONDING_RAW_BIND_ON_EQUIP = 2;

/**
 * O vínculo final de uma peça, sem personagem — três fontes, nesta ordem de
 * precedência:
 *
 * ```
 * Type 46 = 1 do bônus   →  Warbound until equipped   (vence tudo)
 * bit 27 de Flags[0]     →  Warband                   (vence o Bonding)
 * Bonding cru             →  1 = bind_on_pickup, 2 = bind_on_equip
 * ```
 *
 * Medido: `Mural`/`Hex Lord's Visage` têm `Bonding = 1` com o bit 27 ligado,
 * e o tooltip diz `Binds to Warband`, não `Binds when picked up` — ler só o
 * `Bonding` erra em 13.899 itens do build. `Pyrewalker's Doublet` tem
 * `Bonding = 1` com o bit 27 DESLIGADO e um `Type 46 = 1` no itemString, e o
 * tooltip diz `Warbound until equipped` — o bônus vence os dois.
 *
 * `Bonding` cru fora de `{1, 2}` (nenhum, on-use, quest...) não tem espécime
 * na fixture e não é um dos três estados que o `WowBonding` distingue —
 * `null`, lacuna, nunca um chute.
 */
export function resolverVinculo(
  bondingBase: number,
  flags: readonly number[],
  overrideDoBonus: WowBonding | null,
): WowBonding | null {
  if (overrideDoBonus !== null) return overrideDoBonus;

  if (((flags[0] ?? 0) & BIT_WARBAND) !== 0) return WOW_BONDINGS.WARBAND;

  if (bondingBase === BONDING_RAW_BIND_ON_PICKUP) return WOW_BONDINGS.BIND_ON_PICKUP;
  if (bondingBase === BONDING_RAW_BIND_ON_EQUIP) return WOW_BONDINGS.BIND_ON_EQUIP;

  return null;
}
