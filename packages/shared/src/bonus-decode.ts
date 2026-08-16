import { z } from 'zod';
import { bonusTertiarySchema } from './bonus-dictionary-file.js';

/**
 * A saída do decodificador de bonus IDs — TIT-82.
 *
 * ESTRUTURA, nunca frase pronta (`"Mythic 4/6 · Avoidance · Socket"`). A tela
 * monta a frase que quiser, e o explorador de loot precisa filtrar e agregar
 * por modificador — é o requisito que já descartou o tooltip do Wowhead.
 *
 * Mesmo objeto que a TIT-135 (popover de item) vai consumir — decidido junto
 * aqui para as duas tarefas se encontrarem neste formato.
 */
export const decodedTrackSchema = z.object({
  /** `Myth`, `Hero`, `Champion`... */
  nome: z.string(),
  /** O `4` em "4/6". */
  rank: z.number().int(),
  /** O `6` em "4/6". */
  de: z.number().int(),
});
export type DecodedTrack = z.infer<typeof decodedTrackSchema>;

export const decodedBonusesSchema = z.object({
  /** Nulo quando nenhum bonus de track está presente — não é erro. */
  track: decodedTrackSchema.nullable(),

  /** Quantos bonus de socket apareceram. Zero é o caso comum. */
  sockets: z.number().int().nonnegative(),

  terciarios: bonusTertiarySchema.array(),

  /**
   * Bonus IDs que NÃO estão no dicionário — campo de PRIMEIRA CLASSE, não
   * sobra. É o que permite a tela dizer honestamente o que não sabe, em vez
   * de omitir e parecer completa. Nunca trava a exibição do resto.
   */
  desconhecidos: z.number().int().positive().array(),
});
export type DecodedBonuses = z.infer<typeof decodedBonusesSchema>;
