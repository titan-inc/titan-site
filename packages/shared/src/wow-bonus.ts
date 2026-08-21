import { z } from 'zod';

/**
 * O que um bonus id faz — TIT-137, substituindo o dicionário curado da TIT-82.
 *
 * ## Não existe mais `kind`
 *
 * A versão anterior modelava a entrada como union discriminada por `kind`
 * (`track` | `tertiary` | `socket`). **Medido no build 12.1.0: 19% dos bonus
 * ids carregam mais de um significado**, e são justamente os que mais aparecem
 * em loot de raid —
 *
 * ```
 * 12825  →  track + qualidade + scale config
 * 12820  →  scale config + track + qualidade
 * ```
 *
 * Um `kind` singular obrigaria a gravar três linhas para o mesmo id ou a
 * perder dois dos três significados. Aqui é **um objeto por bonus, com uma
 * faceta por coluna, nula quando não se aplica**.
 */

/**
 * Os quatro terciários observados. Lista fechada de propósito: um quinto
 * terciário é decodificação nova a conferir, não um valor a mais adivinhado
 * aqui.
 */
export const BONUS_TERTIARIES = {
  AVOIDANCE: 'avoidance',
  LEECH: 'leech',
  SPEED: 'speed',
  INDESTRUCTIBLE: 'indestructible',
} as const;
export const bonusTertiarySchema = z.nativeEnum(BONUS_TERTIARIES);
export type BonusTertiary = z.infer<typeof bonusTertiarySchema>;

/**
 * Como a peça se vincula, quando um bônus sobrescreve o vínculo do item base.
 *
 * Espelha o enum `WowBonding` do Prisma. Hoje só o `warbound_until_equipped`
 * foi medido (`Type 46 = 1`, do bônus `11215`); os outros existem porque são
 * os estados que o `GlobalStrings` distingue.
 *
 * **Atenção ao renderizar sem personagem**, que é o nosso caso: o jogo usa a
 * forma "Binds to…" e não "…bound". `warbound_until_equipped` vira
 * `Binds to Warband until equipped`, nunca `Warbound until equipped`.
 */
export const WOW_BONDINGS = {
  BIND_ON_PICKUP: 'bind_on_pickup',
  BIND_ON_EQUIP: 'bind_on_equip',
  WARBAND: 'warband',
  WARBOUND_UNTIL_EQUIPPED: 'warbound_until_equipped',
} as const;
export const wowBondingSchema = z.nativeEnum(WOW_BONDINGS);
export type WowBonding = z.infer<typeof wowBondingSchema>;

/** Qual coluna de multiplicador o item usa. Espelha o enum `WowScalingType`. */
export const WOW_SCALING_TYPES = {
  ARMOR: 'armor',
  WEAPON: 'weapon',
  TRINKET: 'trinket',
  JEWELRY: 'jewelry',
} as const;
export const wowScalingTypeSchema = z.nativeEnum(WOW_SCALING_TYPES);
export type WowScalingType = z.infer<typeof wowScalingTypeSchema>;

/**
 * As facetas de um bonus. Nulo em toda faceta que este bonus não toca.
 *
 * Nulo aqui é sempre "este bonus não faz isso", nunca "não sabemos" — bonus
 * que a gente não conhece não vira linha com tudo nulo, ele simplesmente **não
 * está na tabela**, e o decodificador o devolve em `desconhecidos` (Regra 7).
 */
export const bonusFacetsSchema = z.object({
  bonusId: z.number().int().positive(),

  /** `Myth`, `Hero`, `Champion`… do `SharedString` apontado pelo `Type 34`. */
  trackName: z.string().min(1).nullable(),
  /** O `4` em "4/6". */
  trackRank: z.number().int().positive().nullable(),
  /** O `6` em "4/6" — entradas do grupo com `Flags != 3`. */
  trackMaxRank: z.number().int().positive().nullable(),

  /**
   * `ItemGroupIlvlScalingID` do grupo — quem decide se a linha de track
   * APARECE. Peça de season passada mostra só `Myth`, sem o `4/6`.
   *
   * A comparação com a season corrente é do renderizador, nunca do gerador: a
   * virada de season não é patch do cliente, então congelar a decisão na
   * geração acertaria no dia e passaria a errar depois, sem nada disparar.
   */
  trackScalingId: z.number().int().nullable(),

  /** O ilvl que este bonus determina, via `Type 49`. */
  itemLevel: z.number().int().positive().nullable(),

  tertiary: bonusTertiarySchema.nullable(),

  /** `Type 6` — acrescenta um socket. */
  hasSocket: z.boolean(),

  binding: wowBondingSchema.nullable(),

  /** `Mythic`, `Heroic`, `Raid Finder` — do `ItemNameDescription`. */
  difficulty: z.string().min(1).nullable(),
  difficultyColor: z.number().int().nullable(),

  /** `Type 3` — a qualidade que este bonus impõe. */
  quality: z.number().int().nullable(),
});
export type BonusFacets = z.infer<typeof bonusFacetsSchema>;
