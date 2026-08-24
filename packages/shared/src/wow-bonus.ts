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
 * `Indestructible` é FLAG na tela — o jogo mostra só a palavra, mesmo a
 * fórmula calculando um número de verdade (68 no espécime verificado). Os
 * outros três (avoidance/leech/speed) mostram o valor normal.
 *
 * `ComputedStatTerciario.valor` (TIT-136, `item-computation.ts`) sempre traz
 * o número calculado pra todos — é estrutura, quem filtra ou ordena por
 * terciário precisa dele. Esta função é a regra de EXIBIÇÃO, separada do
 * dado: sem ela, "não mostra o valor de indestructible" viraria prosa só no
 * comentário do schema, em outro pacote, e o dia que nascer um quinto
 * terciário ninguém saberia que essa regra existe pra revisar.
 */
export function exibeValorDoTerciario(tipo: BonusTertiary): boolean {
  return tipo !== BONUS_TERTIARIES.INDESTRUCTIBLE;
}

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

  /**
   * O segundo valor do `Value` do `Type 49`/`51` — o desempate quando duas
   * listas do mesmo `itemString` disputam o ilvl. **O `0` vence.**
   *
   * Cru de propósito: um espécime só (o `Ancient Amani Greataxe`) não prova o
   * enum inteiro do campo. Quem aplica a regra é `escolherItemLevel`.
   */
  itemLevelMarcador: z.number().int().nullable(),

  /**
   * Os stats que este bonus ACRESCENTA — o `Type 2`, pareados por posição.
   *
   * **Substituiu o campo `tertiary`, que era um enum único.** O `Type 2`
   * acrescenta qualquer stat e quase sempre dois de uma vez (740 listas com
   * dois, contra 8 por terciário), e a maioria é secundário. O terciário
   * deriva daqui, com o valor junto — ver `terciariosDe`.
   */
  statIds: z.number().int().array(),
  statAllocs: z.number().int().array(),

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

/** Os ids de stat que o jogo trata como terciário. Ver `BONUS_TERTIARIES`. */
export const STAT_ID_TERCIARIO: Readonly<Record<number, BonusTertiary>> = {
  61: BONUS_TERTIARIES.SPEED,
  62: BONUS_TERTIARIES.LEECH,
  63: BONUS_TERTIARIES.AVOIDANCE,
  64: BONUS_TERTIARIES.INDESTRUCTIBLE,
};

/** Um stat que um bonus acrescenta, já despareado dos arrays. */
export interface StatAdicionado {
  statId: number;
  alocacao: number;
}

/** Despareia `statIds`/`statAllocs` de um bonus. */
export function statsAdicionadosDe(
  facetas: Pick<BonusFacets, 'statIds' | 'statAllocs'>,
): StatAdicionado[] {
  return facetas.statIds.map((statId, i) => ({ statId, alocacao: facetas.statAllocs[i] ?? 0 }));
}

/**
 * Os terciários de uma lista de stats acrescentados, com a **alocação**.
 *
 * A alocação não é constante e não pode ser assumida: medida no build 12.1.0,
 * Speed vai de 1925 a 5973, Leech de 3000 a 23892, Avoidance de 1925 a 11946.
 * Só `indestructible` é sempre 3000 — e ele é flag, o jogo mostra a palavra.
 */
export function terciariosDe(
  stats: readonly StatAdicionado[],
): Array<{ tipo: BonusTertiary; alocacao: number }> {
  const saida: Array<{ tipo: BonusTertiary; alocacao: number }> = [];
  for (const { statId, alocacao } of stats) {
    const tipo = STAT_ID_TERCIARIO[statId];
    if (tipo !== undefined) saida.push({ tipo, alocacao });
  }
  return saida;
}

/**
 * Qual `itemLevel` vale, entre os bonus que determinam um.
 *
 * **O `itemLevelMarcador` 0 vence.** Sem isto, duas listas do mesmo
 * `itemString` disputando o ilvl seriam desempatadas pela ordem de iteração —
 * que não é regra, é sorte, e erra em silêncio arrastando todos os stats.
 *
 * Medido no `Ancient Amani Greataxe`: `13844` traz `"449,1"` (ilvl 256) e
 * `13845` traz `"450,0"` (ilvl 263, o que o tooltip mostra).
 *
 * Empate entre marcadores iguais mantém o último — não há evidência de que
 * aconteça, e degradar é melhor que estourar no meio de uma raid.
 */
export function escolherItemLevel(
  candidatos: ReadonlyArray<Pick<BonusFacets, 'itemLevel' | 'itemLevelMarcador'>>,
): number | null {
  let escolhido: number | null = null;
  let melhorMarcador: number | null = null;

  for (const c of candidatos) {
    if (c.itemLevel === null) continue;

    // Marcador ausente conta como 0: bonus que traz ilvl sem disputar ninguém
    // é o caso esmagadoramente comum, e ele tem que vencer o `1` de um
    // concorrente. Só o marcador MAIOR é descartado.
    const marcador = c.itemLevelMarcador ?? 0;
    if (melhorMarcador !== null && marcador > melhorMarcador) continue;

    escolhido = c.itemLevel;
    melhorMarcador = marcador;
  }

  return escolhido;
}
