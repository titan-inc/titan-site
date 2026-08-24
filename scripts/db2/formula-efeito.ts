import type { DatabaseSync } from 'node:sqlite';
import type { EfeitoDoItem, SpellEfeitoBruto } from '../../packages/shared/dist/index.mjs';

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
 * filtro prévio — diferente do caminho de ops (que filtra pra caber no
 * teto de corpo), aqui todo `SpellID` citado é sempre resolvível na hora, não existe
 * "spell fora do extraído". O que vai pra `WowItemData.effects` é só a
 * receita do PRÓPRIO spell do item (`$sN`/`$d`/`$u` já resolvíveis); um
 * `$@spelldescN` que cite outro spell fica como placeholder cru no
 * template — nenhum espécime da fixture exercita essa referência cruzada.
 *
 * `EfeitoDoItem`/`SpellEfeitoBruto` (a forma) e `calcularEscalaDoEfeito`/
 * `calcularValorEfeito`/`renderizarTexto` (as funções puras) moraram aqui
 * até a TIT-136 — migraram pro `packages/shared` porque o resolvedor de
 * runtime precisa do MESMO cálculo. O que fica é só a classe: ela lê
 * `DatabaseSync`, existe pra ler db2.
 */
export type { EfeitoDoItem, SpellEfeitoBruto };

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
