import type { DatabaseSync } from 'node:sqlite';

/**
 * O track de upgrade — `Upgrade Level: Adventurer 1/6`. Ver "O track de
 * upgrade — resolvido, inteiro" em `docs/db2-do-cliente.md`.
 *
 * ```
 * Type 34 do bônus = ( ItemBonusListGroupID , SharedString.ID )
 * nome    = SharedString[ segundo valor ].String_lang
 * entrada = ItemBonusListGroupEntry onde ItemBonusListID = <este bonusId>
 * rank    = entrada.SequenceValue
 * total   = quantas entradas do grupo têm Flags != 3
 * ```
 *
 * **O total NÃO é "entradas com o mesmo Flags"** — regra anterior, errada em
 * 193 dos 235 grupos. É sempre `Flags != 3`.
 */

interface EntradaGrupo {
  itemBonusListGroupId: number;
  itemBonusListId: number;
  sequenceValue: number;
  flags: number;
}

export interface Track {
  nome: string;
  rank: number;
  total: number;
  /** `ItemBonusListGroup.ItemGroupIlvlScalingID` — quem decide se a linha
   * aparece é o renderizador, comparando com a season corrente. O gerador só
   * grava. */
  scalingId: number;
}

export class ResolvedorTrack {
  private readonly type34PorBonus: Map<number, { groupId: number; sharedStringId: number }>;
  private readonly entradasPorGrupo: Map<number, EntradaGrupo[]>;
  private readonly nomePorSharedStringId: Map<number, string>;
  private readonly scalingIdPorGrupo: Map<number, number>;

  constructor(db: DatabaseSync) {
    const type34 = db
      .prepare(`SELECT ParentItemBonusListID, Value FROM ItemBonus WHERE Type = 34`)
      .all() as unknown as Array<{
      ParentItemBonusListID: number;
      Value: string;
    }>;
    this.type34PorBonus = new Map(
      type34.map((l) => {
        const [groupId, sharedStringId] = l.Value.split(',').map(Number);
        return [
          l.ParentItemBonusListID,
          { groupId: groupId ?? 0, sharedStringId: sharedStringId ?? 0 },
        ];
      }),
    );

    const entradas = db
      .prepare(
        `SELECT ItemBonusListGroupID, ItemBonusListID, SequenceValue, Flags FROM ItemBonusListGroupEntry`,
      )
      .all() as unknown as Array<{
      ItemBonusListGroupID: number;
      ItemBonusListID: number;
      SequenceValue: number;
      Flags: number;
    }>;
    this.entradasPorGrupo = new Map();
    for (const e of entradas) {
      const entrada: EntradaGrupo = {
        itemBonusListGroupId: e.ItemBonusListGroupID,
        itemBonusListId: e.ItemBonusListID,
        sequenceValue: e.SequenceValue,
        flags: e.Flags,
      };
      let lista = this.entradasPorGrupo.get(e.ItemBonusListGroupID);
      if (!lista) {
        lista = [];
        this.entradasPorGrupo.set(e.ItemBonusListGroupID, lista);
      }
      lista.push(entrada);
    }

    const strings = db
      .prepare(`SELECT ID, String_lang FROM SharedString`)
      .all() as unknown as Array<{
      ID: number;
      String_lang: string;
    }>;
    this.nomePorSharedStringId = new Map(strings.map((s) => [s.ID, s.String_lang]));

    const grupos = db
      .prepare(`SELECT ID, ItemGroupIlvlScalingID FROM ItemBonusListGroup`)
      .all() as unknown as Array<{
      ID: number;
      ItemGroupIlvlScalingID: number;
    }>;
    this.scalingIdPorGrupo = new Map(grupos.map((g) => [g.ID, g.ItemGroupIlvlScalingID]));
  }

  /**
   * `null` quando o bônus não carrega `Type 34` (não é track) — OU quando o
   * segundo valor do `Type 34` é `0`.
   *
   * Achado ao ampliar `bonuses` pra todo bonusId do build (ponto 1 da
   * revisão da PR #98): **492 dos 696 `Type 34` do build inteiro têm
   * `sharedStringId = 0`**, e `SharedString.ID` nunca é `0` (menor id é
   * `740`) — não é lacuna de extração, é o campo dizendo "sem nome". Os
   * grupos se dividem limpo: nenhum grupo mistura entrada com e sem nome, 52
   * grupos são só-sem-nome e 26 são só-com-nome. Os sem nome têm
   * `ItemLevelSelectorID`/`ItemExtendedCostID` na entrada do grupo — cheiro
   * de upgrade comprado com moeda (crafting), não track de loot. Nenhum dos
   * 21 espécimes da fixture passa por um `Type 34` sem nome, porque loot de
   * raid sempre nomeia a track.
   */
  resolver(bonusId: number): Track | null {
    const type34 = this.type34PorBonus.get(bonusId);
    if (!type34 || type34.sharedStringId === 0) return null;

    const nome = this.nomePorSharedStringId.get(type34.sharedStringId);
    if (nome === undefined) {
      throw new Error(
        `SharedString ${type34.sharedStringId} não existe no dump — extração incompleta.`,
      );
    }

    const entradasDoGrupo = this.entradasPorGrupo.get(type34.groupId) ?? [];
    const entradaDoBonus = entradasDoGrupo.find((e) => e.itemBonusListId === bonusId);
    const rank = entradaDoBonus?.sequenceValue ?? 1; // ausente no grupo → rank padrão.
    const total = entradasDoGrupo.filter((e) => e.flags !== 3).length;
    const scalingId = this.scalingIdPorGrupo.get(type34.groupId) ?? 0;

    return { nome, rank, total, scalingId };
  }
}
