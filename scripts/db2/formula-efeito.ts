import type { DatabaseSync } from 'node:sqlite';
import type { LinhaEscala } from './montar-escalas.js';

/**
 * O texto de efeito (trinket, "Use:", "Equip:") — ver "O texto de efeito:
 * template, e nenhum valor guardado" e "O ScalingClass decide de qual coluna
 * sai a escala" em `docs/db2-do-cliente.md`.
 *
 * ```
 * ItemXItemEffect → ItemEffect → Spell.Description_lang (com $sN, $d, $u)
 * SpellEffect.Coefficient × escala(ScalingClass, ilvl) = valor de $sN
 * ```
 *
 * **Lacuna conhecida, não falha dura:** o cooldown do proc ("2 Min
 * Cooldown") não sai de nenhuma tabela extraída — `ItemEffect.CoolDownMSec`
 * é `-1` no único espécime que exercita isto (`Blazebinder's Hoof`), e o
 * valor real mora em `SpellCooldowns`/`SpellCategories`, que não estão na
 * lista de extração de `docs/db2-do-cliente.md`. Registrado como aberto — a
 * fixture confere os quatro placeholders que TÊM fonte (`$s1`, `$s2`, `$d`,
 * `$u`), não o texto inteiro.
 *
 * **Sobre o "fecho de spells":** este gerador lê o `wow.db` inteiro, sem
 * filtro prévio — diferente do caminho de ops (que filtra pra caber em
 * 2mb), aqui todo `SpellID` citado é sempre resolvível na hora, não existe
 * "spell fora do extraído". O que vai pra `WowItemData.effects` é só a
 * receita do PRÓPRIO spell do item (`$sN`/`$d`/`$u` já resolvíveis); um
 * `$@spelldescN` que cite outro spell fica como placeholder cru no
 * template — nenhum espécime da fixture exercita essa referência cruzada.
 */

export interface SpellEfeitoBruto {
  effectIndex: number;
  coefficient: number;
  scalingClass: number;
}

export interface EfeitoDoItem {
  spellId: number;
  descricaoTemplate: string;
  duracaoMs: number | null;
  maxStacks: number | null;
  efeitos: SpellEfeitoBruto[];
}

export class ResolvedorEfeito {
  private readonly spellIdPorItem: Map<number, number>;
  private readonly descricaoPorSpell: Map<number, string>;
  private readonly efeitosPorSpell: Map<number, SpellEfeitoBruto[]>;
  private readonly duracaoMsPorSpell: Map<number, number>;
  private readonly maxStacksPorSpell: Map<number, number>;

  constructor(db: DatabaseSync) {
    const itemEffect = db
      .prepare(`SELECT ItemID, ItemEffectID FROM ItemXItemEffect`)
      .all() as unknown as Array<{
      ItemID: number;
      ItemEffectID: number;
    }>;
    const spellPorEffectId = new Map(
      (
        db.prepare(`SELECT ID, SpellID FROM ItemEffect`).all() as unknown as Array<{
          ID: number;
          SpellID: number;
        }>
      ).map((l) => [l.ID, l.SpellID]),
    );
    this.spellIdPorItem = new Map();
    for (const l of itemEffect) {
      const spellId = spellPorEffectId.get(l.ItemEffectID);
      if (spellId) this.spellIdPorItem.set(l.ItemID, spellId);
    }

    this.descricaoPorSpell = new Map(
      (
        db.prepare(`SELECT ID, Description_lang FROM Spell`).all() as unknown as Array<{
          ID: number;
          Description_lang: string;
        }>
      ).map((l) => [l.ID, l.Description_lang]),
    );

    const spellEffects = db
      .prepare(
        `SELECT SpellID, EffectIndex, Coefficient, ScalingClass FROM SpellEffect WHERE Coefficient != 0 ORDER BY SpellID, EffectIndex`,
      )
      .all() as unknown as Array<{
      SpellID: number;
      EffectIndex: number;
      Coefficient: number;
      ScalingClass: number;
    }>;
    this.efeitosPorSpell = new Map();
    for (const l of spellEffects) {
      let lista = this.efeitosPorSpell.get(l.SpellID);
      if (!lista) {
        lista = [];
        this.efeitosPorSpell.set(l.SpellID, lista);
      }
      lista.push({
        effectIndex: l.EffectIndex,
        coefficient: l.Coefficient,
        scalingClass: l.ScalingClass,
      });
    }

    const duracaoPorId = new Map(
      (
        db.prepare(`SELECT ID, Duration FROM SpellDuration`).all() as unknown as Array<{
          ID: number;
          Duration: number;
        }>
      ).map((l) => [l.ID, l.Duration]),
    );
    const misc = db
      .prepare(`SELECT SpellID, DurationIndex FROM SpellMisc`)
      .all() as unknown as Array<{
      SpellID: number;
      DurationIndex: number;
    }>;
    this.duracaoMsPorSpell = new Map();
    for (const l of misc) {
      const duracao = duracaoPorId.get(l.DurationIndex);
      if (duracao !== undefined && duracao > 0) this.duracaoMsPorSpell.set(l.SpellID, duracao);
    }

    this.maxStacksPorSpell = new Map(
      (
        db
          .prepare(`SELECT SpellID, CumulativeAura FROM SpellAuraOptions WHERE CumulativeAura != 0`)
          .all() as unknown as Array<{
          SpellID: number;
          CumulativeAura: number;
        }>
      ).map((l) => [l.SpellID, l.CumulativeAura]),
    );
  }

  resolverPorItem(itemId: number): EfeitoDoItem | null {
    const spellId = this.spellIdPorItem.get(itemId);
    if (!spellId) return null;

    const descricaoTemplate = this.descricaoPorSpell.get(spellId);
    if (descricaoTemplate === undefined) {
      throw new Error(
        `Spell ${spellId} não existe no dump — extração incompleta (fecho de spells).`,
      );
    }

    return {
      spellId,
      descricaoTemplate,
      duracaoMs: this.duracaoMsPorSpell.get(spellId) ?? null,
      maxStacks: this.maxStacksPorSpell.get(spellId) ?? null,
      efeitos: this.efeitosPorSpell.get(spellId) ?? [],
    };
  }
}

/**
 * `escala(ScalingClass, ilvl)` — só o `EpicF[0]` está medido (o `−1` e o
 * `−8` do espécime verificado). Os outros ramos seguem a fórmula do SimC
 * como está escrita, sem espécime que os confirme — ver a doc.
 */
export function calcularEscalaDoEfeito(scalingClass: number, escala: LinhaEscala): number {
  if (scalingClass === -8) return escala.damageReplaceStat;
  if (scalingClass === 0 || scalingClass === -9) return escala.damageSecondary;
  // −7 usaria CombatRatingsMultByILvl também, mas nenhum espécime distingue
  // qual coluna (armor/weapon/trinket/jewelry) — não exercitado, sem aposta.
  return escala.budget[0] ?? 0;
}

/**
 * `round`, não `floor` — os dois exemplos verificados da doc pareciam floor
 * (105,044→105, "77.365,5"→77365) porque a doc mostra o cru arredondado a 1
 * casa. Um segundo espécime (rank 2 do mesmo trinket) desfez a ambiguidade:
 * o cru real é 79.752,998 (não 79.753,0 como a tabela sugeria) e o tooltip
 * mostra 79753 — só `round` fecha os dois ranks ao mesmo tempo.
 */
export function calcularValorEfeito(
  coefficient: number,
  scalingClass: number,
  escala: LinhaEscala,
): number {
  return Math.round(coefficient * calcularEscalaDoEfeito(scalingClass, escala));
}

/** Substitui `$sN`, `$d` (em segundos) e `$u` — os únicos placeholders com
 * fonte extraída. Outros (`$@spelldescN`, `$w1`...) ficam como estão. */
export function renderizarTexto(
  efeito: EfeitoDoItem,
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
