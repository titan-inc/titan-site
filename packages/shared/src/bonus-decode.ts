import { z } from 'zod';
import { bonusTertiarySchema, wowBondingSchema } from './wow-bonus.js';

/**
 * A saída do decodificador de bonus IDs — TIT-82, remodelada pela TIT-137.
 *
 * ESTRUTURA, nunca frase pronta (`"Mythic 4/6 · Avoidance · Socket"`). A tela
 * monta a frase que quiser, e o explorador de loot precisa filtrar e agregar
 * por modificador — é o requisito que já descartou o tooltip do Wowhead.
 *
 * Mesmo objeto que a TIT-135 (popover de item) consome.
 */
export const decodedTrackSchema = z.object({
  /** `Myth`, `Hero`, `Champion`... */
  nome: z.string(),
  /** O `4` em "4/6". */
  rank: z.number().int(),
  /** O `6` em "4/6". */
  de: z.number().int(),

  /**
   * O `ItemGroupIlvlScalingID` do grupo de track.
   *
   * **A TELA NÃO PODE IMPRIMIR `rank/de` SEM CONFERIR ISTO.** Peça de season
   * passada perde a contagem no jogo: o que era `Myth 4/6` vira só `Myth`.
   * Quem sabe qual é a season corrente é o renderizador, não este objeto — por
   * isso o número vem cru, e não uma flag `atual: boolean` que congelaria a
   * resposta no momento em que a linha foi gravada.
   */
  scalingId: z.number().int().nullable(),
});
export type DecodedTrack = z.infer<typeof decodedTrackSchema>;

export const decodedBonusesSchema = z.object({
  /**
   * O item level que os bonus determinam.
   *
   * Nulo quando nenhum bonus conhecido determina o ilvl — lacuna, nunca o ilvl
   * base do item disfarçado de real. Nunca aproximar.
   */
  itemLevel: z.number().int().positive().nullable(),

  /** Nulo quando nenhum bonus de track está presente — não é erro. */
  track: decodedTrackSchema.nullable(),

  /** Quantos bonus de socket apareceram. Zero é o caso comum. */
  sockets: z.number().int().nonnegative(),

  terciarios: bonusTertiarySchema.array(),

  /**
   * Vínculo imposto por bônus, quando existe — sobrescreve o do item base.
   *
   * É como cai o bonus loot de raid (`warbound_until_equipped`). Nulo é "nenhum
   * bônus mexeu no vínculo", e aí vale o do item.
   */
  binding: wowBondingSchema.nullable(),

  /** `Mythic`, `Heroic`, `Raid Finder`. Nulo em Normal, que não imprime linha. */
  dificuldade: z.string().nullable(),

  /**
   * Bonus IDs que NÃO estão no dicionário — campo de PRIMEIRA CLASSE, não
   * sobra. É o que permite a tela dizer honestamente o que não sabe, em vez
   * de omitir e parecer completa. Nunca trava a exibição do resto.
   */
  desconhecidos: z.number().int().positive().array(),
});
export type DecodedBonuses = z.infer<typeof decodedBonusesSchema>;
