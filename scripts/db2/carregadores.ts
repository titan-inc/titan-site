import type { DatabaseSync } from 'node:sqlite';
import { paraArrayNumerico } from './wow-export-db.js';
import { resolverMaterial, type ArmorLocationLinha } from './formula-armadura-arma.js';

/**
 * Leituras do dump usadas tanto pela auto-conferência quanto pela montagem
 * das tabelas finais — um lugar só, para as duas rodarem sobre o MESMO
 * dado. Cada função é uma tabela (ou uma fatia por `Type`) do `ItemBonus`.
 */

export interface ItemSparseResumo {
  itemLevel: number;
  inventoryType: number;
  statIds: number[];
  statAllocs: number[];
  socketAllocs: number[];
  flags: number[];
  itemDelay: number;
  dmgVariance: number;
  overallQualityId: number;
  bonding: number;
  flavor: string;
  nameDescriptionId: number;
}

export function carregarItemSparse(
  db: DatabaseSync,
  itemIds: number[],
): Map<number, ItemSparseResumo> {
  const placeholders = itemIds.map(() => '?').join(',');
  const linhas = db
    .prepare(
      `SELECT ID, ItemLevel, InventoryType, StatModifier_bonusStat, StatPercentEditor, StatPercentageOfSocket,
              Flags, ItemDelay, DmgVariance, OverallQualityID, Bonding, Description_lang, ItemNameDescriptionID
       FROM ItemSparse WHERE ID IN (${placeholders})`,
    )
    .all(...itemIds) as unknown as Array<{
    ID: number;
    ItemLevel: number;
    InventoryType: number;
    StatModifier_bonusStat: string;
    StatPercentEditor: string;
    StatPercentageOfSocket: string;
    Flags: string;
    ItemDelay: number;
    DmgVariance: number;
    OverallQualityID: number;
    Bonding: number;
    Description_lang: string;
    ItemNameDescriptionID: number;
  }>;

  return new Map(
    linhas.map((l) => [
      l.ID,
      {
        itemLevel: l.ItemLevel,
        inventoryType: l.InventoryType,
        statIds: paraArrayNumerico(l.StatModifier_bonusStat),
        statAllocs: paraArrayNumerico(l.StatPercentEditor),
        socketAllocs: paraArrayNumerico(l.StatPercentageOfSocket),
        flags: paraArrayNumerico(l.Flags),
        itemDelay: l.ItemDelay,
        dmgVariance: l.DmgVariance,
        overallQualityId: l.OverallQualityID,
        bonding: l.Bonding,
        flavor: l.Description_lang,
        nameDescriptionId: l.ItemNameDescriptionID,
      },
    ]),
  );
}

/** `Item.SubclassID` — só ele dá o material de armadura (1 Cloth .. 4 Plate);
 * `ItemSparse.Material` é outra coisa (sheathe/textura), não usar aqui. */
export function carregarMaterialPorItem(db: DatabaseSync, itemIds: number[]): Map<number, number> {
  const placeholders = itemIds.map(() => '?').join(',');
  const linhas = db
    .prepare(`SELECT ID, SubclassID FROM Item WHERE ID IN (${placeholders})`)
    .all(...itemIds) as unknown as Array<{
    ID: number;
    SubclassID: number;
  }>;
  return new Map(linhas.map((l) => [l.ID, resolverMaterial(l.SubclassID)]));
}

/** `ArmorLocation.ID` É o `InventoryType` — confirmado pelas 23 linhas
 * batendo um a um com os slots que o `docs/db2-do-cliente.md` já mapeia. */
export function carregarArmorLocation(db: DatabaseSync): Map<number, ArmorLocationLinha> {
  const linhas = db
    .prepare(
      `SELECT ID, Clothmodifier, Leathermodifier, Chainmodifier, Platemodifier FROM ArmorLocation`,
    )
    .all() as unknown as Array<{
    ID: number;
    Clothmodifier: number;
    Leathermodifier: number;
    Chainmodifier: number;
    Platemodifier: number;
  }>;
  return new Map(
    linhas.map((l) => [
      l.ID,
      {
        clothmodifier: l.Clothmodifier,
        leathermodifier: l.Leathermodifier,
        chainmodifier: l.Chainmodifier,
        platemodifier: l.Platemodifier,
      },
    ]),
  );
}

export interface StatAdicional {
  statId: number;
  alocacao: number;
}

/** `Type 2` (`MOD`, "acrescenta stat") — usado sobretudo pelos terciários
 * (bônus 40-43), mas é mecanismo genérico: qualquer bônus pode injetar uma
 * entrada de stat que não está no `ItemSparse` do item base. */
export function carregarStatsAdicionaisPorBonus(db: DatabaseSync): Map<number, StatAdicional[]> {
  const linhas = db
    .prepare(`SELECT ParentItemBonusListID, Value FROM ItemBonus WHERE Type = 2`)
    .all() as unknown as Array<{
    ParentItemBonusListID: number;
    Value: string;
  }>;

  const porBonus = new Map<number, StatAdicional[]>();
  for (const linha of linhas) {
    const [statId, alocacao] = paraArrayNumerico(linha.Value);
    let lista = porBonus.get(linha.ParentItemBonusListID);
    if (!lista) {
      lista = [];
      porBonus.set(linha.ParentItemBonusListID, lista);
    }
    lista.push({ statId: statId ?? 0, alocacao: alocacao ?? 0 });
  }
  return porBonus;
}

/** `Type 3` (`QUALITY`) — bonusId → qualidade que ele força. */
export function carregarQualidadeExtraPorBonus(db: DatabaseSync): Map<number, number> {
  const linhas = db
    .prepare(`SELECT ParentItemBonusListID, Value FROM ItemBonus WHERE Type = 3`)
    .all() as unknown as Array<{
    ParentItemBonusListID: number;
    Value: string;
  }>;
  return new Map(linhas.map((l) => [l.ParentItemBonusListID, paraArrayNumerico(l.Value)[0] ?? 0]));
}

/**
 * Todo bonusId que existe no `ItemBonus` deste build — **não** só os que a
 * árvore de algum item do catálogo alcança.
 *
 * A árvore (`resolucao-bonus.ts`) responde "que bônus este item pode
 * assumir por contexto", não "que bônus pode aparecer num itemString real".
 * São coisas diferentes: modificadores atribuídos no sorteio do drop (ex.
 * `3524`, `Type 0` no-op, no `itemString` do próprio escudo da fixture; ou
 * `8767`/`1485` no Wallcliber's Incursion Hatchet) não estão em nó de
 * árvore nem em entrada de grupo em lugar NENHUM do build — confirmado
 * varrendo `ChildItemBonusListID` e `ItemBonusListGroupEntry` inteiros.
 *
 * Sem isso, `WowBonus` cobria ~4% dos bonus ids do build (425 de 10.085), e
 * "ausente da tabela" — que devia significar "esse id não existe neste
 * build" (Regra 7) — na prática significava também "a árvore não ofereceu",
 * que é acidente de caminho, não ausência real. O escudo, o espécime mais
 * estudado do projeto, mostraria "1 bônus desconhecido" para sempre.
 */
export function carregarTodosBonusIds(db: DatabaseSync): Set<number> {
  const linhas = db
    .prepare(`SELECT DISTINCT ParentItemBonusListID FROM ItemBonus`)
    .all() as unknown as Array<{
    ParentItemBonusListID: number;
  }>;
  return new Set(linhas.map((l) => l.ParentItemBonusListID));
}

/** `Type 6` (`SOCKET`) — bonusId que acrescenta socket. */
export function carregarBonusComSocket(db: DatabaseSync): Set<number> {
  const linhas = db
    .prepare(`SELECT DISTINCT ParentItemBonusListID FROM ItemBonus WHERE Type = 6`)
    .all() as unknown as Array<{
    ParentItemBonusListID: number;
  }>;
  return new Set(linhas.map((l) => l.ParentItemBonusListID));
}

/** `Type 46` — em 4 listas no build inteiro, sempre `Value[0] = 1`
 * (`Warbound until equipped`). Nenhum outro valor foi observado — ver
 * "E existe um terceiro estado" na doc. */
export function carregarBindingPorBonus(db: DatabaseSync): Map<number, 'warbound_until_equipped'> {
  const linhas = db
    .prepare(`SELECT ParentItemBonusListID, Value FROM ItemBonus WHERE Type = 46`)
    .all() as unknown as Array<{
    ParentItemBonusListID: number;
    Value: string;
  }>;
  const porBonus = new Map<number, 'warbound_until_equipped'>();
  for (const linha of linhas) {
    if (Number(linha.Value.split(',')[0]) === 1) {
      porBonus.set(linha.ParentItemBonusListID, 'warbound_until_equipped');
    }
  }
  return porBonus;
}

export interface Descritor {
  texto: string;
  cor: number;
}

/** `Type 4` (`DESC`) → `ItemNameDescription` — o descritor de dificuldade
 * (`Mythic`, `Heroic`, `Mythic+`). */
export function carregarDescritorPorBonus(db: DatabaseSync): Map<number, Descritor> {
  const type4 = db
    .prepare(`SELECT ParentItemBonusListID, Value FROM ItemBonus WHERE Type = 4`)
    .all() as unknown as Array<{
    ParentItemBonusListID: number;
    Value: string;
  }>;
  const descricaoPorId = new Map(
    (
      db
        .prepare(`SELECT ID, Description_lang, Color FROM ItemNameDescription`)
        .all() as unknown as Array<{
        ID: number;
        Description_lang: string;
        Color: number;
      }>
    ).map((l) => [l.ID, { texto: l.Description_lang, cor: l.Color }]),
  );

  const porBonus = new Map<number, Descritor>();
  for (const linha of type4) {
    const nameDescId = Number(linha.Value.split(',')[0]);
    const descritor = descricaoPorId.get(nameDescId);
    if (descritor) porBonus.set(linha.ParentItemBonusListID, descritor);
  }
  return porBonus;
}
