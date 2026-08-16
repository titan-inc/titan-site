import { z } from 'zod';

/**
 * O arquivo de carga do dicionário de bonus IDs — TIT-82.
 *
 * É a entrada da rota `POST /internal/ops/bonus-load`. Fica versionado no
 * repositório, mesmo precedente do `CatalogFile`: dado de jogo, não dado de
 * jogador, então não cai na restrição de não versionar dado pessoal.
 *
 * **A app nunca fala com o wago.tools.** O arquivo é obtido e curado à mão —
 * ver `docs/ops.md` — e esta rota só carrega o que já foi decidido.
 *
 * NUNCA GERAR ESTE ARQUIVO POR ARITMÉTICA. Os blocos de track são regulares de
 * um jeito tentador (dificuldade +8, season seguinte +48), mas isso é hipótese
 * a conferir, não regra a codificar — funciona até a season em que não
 * funciona, e falha sem erro nenhum. Cada entrada tem que vir de um id
 * observado de verdade.
 */

/** Vocabulário de tipo de bonus que este sistema entende. */
export const BONUS_KINDS = {
  /** Rank de um track de itemização (`Myth 4/6`, `Hero 2/6`...). */
  TRACK: 'track',
  /** Stat terciário (avoidance, leech, speed, indestructible). */
  TERTIARY: 'tertiary',
  /** Socket extra. */
  SOCKET: 'socket',
} as const;
export const bonusKindSchema = z.nativeEnum(BONUS_KINDS);
export type BonusKind = z.infer<typeof bonusKindSchema>;

/**
 * Os quatro terciários observados — ver a issue TIT-82. Lista fechada de
 * propósito: um quinto terciário novo é entrada nova no dicionário, não um
 * valor a mais aqui adivinhado.
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
 * Uma entrada do dicionário — union discriminada por `kind`.
 *
 * Discriminada, e não um objeto com campos todos opcionais, para o schema
 * recusar `{ kind: 'socket', trackRank: 4 }` na validação em vez de aceitar
 * lixo que o decodificador teria que adivinhar como ignorar.
 */
const bonusTrackEntrySchema = z.object({
  bonusId: z.number().int().positive(),
  kind: z.literal(BONUS_KINDS.TRACK),

  /** `Myth`, `Hero`, `Champion`, `Veteran`... o nome do track. */
  trackName: z.string().min(1),

  /** O `4` em "4/6". Rank DESTE bonus dentro do track. */
  trackRank: z.number().int().positive(),

  /**
   * O `6` em "4/6". Rank máximo do track.
   *
   * Repetido em toda entrada do mesmo track de propósito: cada linha vem do
   * ARQUIVO, um id observado de cada vez — nunca derivado por aritmética a
   * partir das outras linhas. Redundância é o preço de não adivinhar.
   */
  trackMaxRank: z.number().int().positive(),

  /**
   * O item level que ESTE bonus determina, quando já curado.
   *
   * Opcional mesmo dentro de uma entrada de track: saber o rank não implica
   * saber o ilvl — são duas curadorias, e a segunda pode ficar para trás.
   * Ausente aqui é "não curado ainda", nunca "este item não tem ilvl" — quem
   * lê isso é o decodificador, que devolve `itemLevel: null` nesse caso.
   */
  itemLevel: z.number().int().positive().optional(),
});

const bonusTertiaryEntrySchema = z.object({
  bonusId: z.number().int().positive(),
  kind: z.literal(BONUS_KINDS.TERTIARY),
  tertiary: bonusTertiarySchema,
});

const bonusSocketEntrySchema = z.object({
  bonusId: z.number().int().positive(),
  kind: z.literal(BONUS_KINDS.SOCKET),
});

export const bonusDictionaryEntrySchema = z.discriminatedUnion('kind', [
  bonusTrackEntrySchema,
  bonusTertiaryEntrySchema,
  bonusSocketEntrySchema,
]);
export type BonusDictionaryEntry = z.infer<typeof bonusDictionaryEntrySchema>;

export const bonusDictionaryFileSchema = z.object({
  /** Versão do formato do arquivo — mesmo motivo do `CatalogFile.version`. */
  version: z.literal(1),

  bonuses: bonusDictionaryEntrySchema.array().nonempty(),
});
export type BonusDictionaryFile = z.infer<typeof bonusDictionaryFileSchema>;
