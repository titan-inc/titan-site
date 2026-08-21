import type { DatabaseSync } from 'node:sqlite';
import { paraArrayNumerico } from './wow-export-db.js';
import type { GameTables, MultiplicadorPorTipo } from './game-tables.js';
import { COLS_SCALING } from '../../packages/shared/dist/index.mjs';

/**
 * A escala por item level — colapsa onze db2 numa linha por ilvl. **NÃO
 * CORTAR**: o catálogo tem itens de Dragonflight S1 com ilvl base até 662,
 * então sai com as 1.300 linhas inteiras (a hipótese de cortar em ~340 que a
 * TIT-137 registrava está descartada com número — ver "A faixa de item
 * level" na TIT-139).
 */
export interface LinhaEscala {
  itemLevel: number;
  budget: number[];
  damageReplaceStat: number;
  damageSecondary: number;
  crMult: MultiplicadorPorTipo;
  stamMult: MultiplicadorPorTipo;
  socketCost: number;
  armorTotal: number[];
  armorQuality: number[];
  armorShield: number[];
  dmgOneHand: number[];
  dmgTwoHand: number[];
  dmgOneHandCaster: number[];
  dmgTwoHandCaster: number[];
}

/** A forma rica, por ilvl — usada pela auto-conferência e pela montagem de itens. */
export function montarEscalasPorIlvl(
  db: DatabaseSync,
  gameTables: GameTables,
): Map<number, LinhaEscala> {
  const randProp = carregarLinhasPorIlvl<{
    EpicF: string;
    DamageReplaceStatF: number;
    DamageSecondaryF: number;
  }>(db, 'RandPropPoints', ['EpicF', 'DamageReplaceStatF', 'DamageSecondaryF']);
  const armorTotal = carregarLinhasPorIlvl<{
    Cloth: number;
    Leather: number;
    Mail: number;
    Plate: number;
  }>(db, 'ItemArmorTotal', ['Cloth', 'Leather', 'Mail', 'Plate']);
  const armorQuality = carregarColunaArrayPorIlvl(db, 'ItemArmorQuality', 'Qualitymod');
  const armorShield = carregarColunaArrayPorIlvl(db, 'ItemArmorShield', 'Quality');
  const dmgOneHand = carregarColunaArrayPorIlvl(db, 'ItemDamageOneHand', 'Quality');
  const dmgTwoHand = carregarColunaArrayPorIlvl(db, 'ItemDamageTwoHand', 'Quality');
  const dmgOneHandCaster = carregarColunaArrayPorIlvl(db, 'ItemDamageOneHandCaster', 'Quality');
  const dmgTwoHandCaster = carregarColunaArrayPorIlvl(db, 'ItemDamageTwoHandCaster', 'Quality');

  const porIlvl = new Map<number, LinhaEscala>();
  for (const [ilvl, rp] of randProp) {
    const armor = armorTotal.get(ilvl);
    porIlvl.set(ilvl, {
      itemLevel: ilvl,
      budget: paraArrayNumerico(rp.EpicF),
      damageReplaceStat: Number(rp.DamageReplaceStatF),
      damageSecondary: Number(rp.DamageSecondaryF),
      crMult: gameTables.combatRatingsMultByILvl.get(ilvl) ?? multiplicadorZerado(),
      stamMult: gameTables.staminaMultByILvl.get(ilvl) ?? multiplicadorZerado(),
      // Termo morto acima do ilvl 60 (ver docs/db2-do-cliente.md). A
      // GameTable só cobre até ilvl 1000; ausência acima disso é o próprio
      // dado da Blizzard, não lacuna nossa — 0 é o valor neutro da fórmula.
      socketCost: gameTables.itemSocketCostPerLevel.get(ilvl) ?? 0,
      armorTotal: armor ? [armor.Cloth, armor.Leather, armor.Mail, armor.Plate] : [0, 0, 0, 0],
      armorQuality: armorQuality.get(ilvl) ?? [],
      armorShield: armorShield.get(ilvl) ?? [],
      dmgOneHand: dmgOneHand.get(ilvl) ?? [],
      dmgTwoHand: dmgTwoHand.get(ilvl) ?? [],
      dmgOneHandCaster: dmgOneHandCaster.get(ilvl) ?? [],
      dmgTwoHandCaster: dmgTwoHandCaster.get(ilvl) ?? [],
    });
  }
  return porIlvl;
}

/** A forma colunar (`COLS_SCALING`) que vai pro arquivo final. */
export function montarTabelaEscalas(porIlvl: Map<number, LinhaEscala>): {
  cols: readonly string[];
  rows: unknown[][];
} {
  const rows = [...porIlvl.values()].map((e) => [
    e.itemLevel,
    e.budget,
    e.damageReplaceStat,
    e.damageSecondary,
    multiplicadorComoArray(e.crMult),
    multiplicadorComoArray(e.stamMult),
    e.socketCost,
    e.armorTotal,
    e.armorQuality,
    e.armorShield,
    e.dmgOneHand,
    e.dmgTwoHand,
    e.dmgOneHandCaster,
    e.dmgTwoHandCaster,
  ]);
  return { cols: COLS_SCALING, rows };
}

function multiplicadorZerado(): MultiplicadorPorTipo {
  return { armor: 0, weapon: 0, trinket: 0, jewelry: 0 };
}

function multiplicadorComoArray(m: MultiplicadorPorTipo): number[] {
  return [m.armor, m.weapon, m.trinket, m.jewelry];
}

/** Tabelas com uma coluna CSV só (`"a,b,c"`) por ilvl, ex. `Quality`. */
function carregarColunaArrayPorIlvl(
  db: DatabaseSync,
  tabela: string,
  coluna: string,
): Map<number, number[]> {
  const linhas = db
    .prepare(`SELECT ID, "${coluna}" as valor FROM "${tabela}"`)
    .all() as unknown as Array<{
    ID: number;
    valor: string;
  }>;
  return new Map(linhas.map((l) => [l.ID, paraArrayNumerico(l.valor)]));
}

/** Tabelas com colunas escalares separadas por ilvl, ex. `ItemArmorTotal`. */
function carregarLinhasPorIlvl<T>(
  db: DatabaseSync,
  tabela: string,
  colunas: string[],
): Map<number, T> {
  const linhas = db
    .prepare(`SELECT ID, ${colunas.map((c) => `"${c}"`).join(', ')} FROM "${tabela}"`)
    .all() as unknown as Array<T & { ID: number }>;
  return new Map(linhas.map((l) => [l.ID, l]));
}
