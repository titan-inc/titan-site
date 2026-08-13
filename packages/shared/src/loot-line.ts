import { z } from 'zod';
import { lootResponseSlugSchema } from './loot-response.js';
import { raidDifficultyLevelSchema } from './wow.js';

/**
 * Um personagem numa linha de loot.
 *
 * Sempre o par nome + realm, nunca o nome sozinho — Regra 6. Mesma forma que o
 * `officers.ts` usa: identidade normalizada para comparar, grafia da fonte para
 * exibir.
 *
 * O realm de exibição é guardado, e não derivado do slug, porque o caminho de
 * volta é lossy: 58 dos 344 realms US têm hífen, e `area-52` não diz se o nome é
 * "Area 52" ou "Area-52".
 */
export const lootCharacterSchema = z.object({
  /** Grafia da fonte. Para exibir, nunca para comparar. */
  name: z.string(),
  realm: z.string(),

  /** Identidade. `nameKey` mantém acento (`toCharacterKey`), realm é `toSlug`. */
  nameKey: z.string(),
  realmSlug: z.string(),
});
export type LootCharacter = z.infer<typeof lootCharacterSchema>;

/**
 * De onde a linha de loot veio.
 *
 * Não é detalhe de auditoria: decide o que se pode afirmar sobre a linha. Import
 * do RCLootCouncil traz `rawInstance` localizado e `encounterId` que muitas vezes
 * não resolve; sessão ao vivo nasce com o boss já identificado.
 */
export const LOOT_LINE_SOURCES = {
  IMPORT_RC: 'import_rc',
  IMPORT_WOWAUDIT: 'import_wowaudit',
  LIVE_SESSION: 'live_session',
} as const;

export const lootLineSourceSchema = z.nativeEnum(LOOT_LINE_SOURCES);
export type LootLineSource = z.infer<typeof lootLineSourceSchema>;

/**
 * Uma peça entregue a alguém por decisão do conselho.
 *
 * **Uma linha é um award, não a resposta de um candidato.** Medido no export real:
 * 444 drops distintos em 445 linhas. A resposta aqui é a de **quem levou**, no
 * momento em que levou.
 *
 * Só entra loot distribuído pelo conselho. Bonus roll e personal loot vão direto
 * para o jogador e são propriedade exclusiva dele — não houve decisão a registrar.
 */
export const lootLineSchema = z.object({
  id: z.string(),
  source: lootLineSourceSchema,

  awardedAt: z.string().datetime(),

  /** Quem levou. */
  winner: lootCharacterSchema,

  /** Classe como token do cliente (`MAGE`), não localizada. */
  winnerClass: z.string().nullable(),

  /** Quem lootou no jogo, quando a fonte diz. Nulo quando ela não diz. */
  looter: lootCharacterSchema.nullable(),

  itemId: z.number().int().positive(),

  /**
   * O `itemString` cru e inteiro, sem interpretar.
   *
   * Hoje não sabemos o que distingue o bônus `13333` do `13335`. Preservar o bruto
   * é o que permite enriquecer o histórico retroativamente quando alguém mapear a
   * família de track.
   */
  itemString: z.string(),

  /**
   * De onde foi lootado, como a fonte disse.
   *
   * Localizado e frequentemente irreconciliável: nos 294 registros de conselho o
   * `instance` aparece em 11 grafias, incluindo `A Torre do Caos` (The Voidspire
   * em ptBR). A tela deve preferir o boss resolvido, e cair aqui só quando ele for
   * nulo.
   */
  rawInstance: z.string(),
  rawBoss: z.string(),

  /**
   * O boss do catálogo, quando resolveu.
   *
   * Nulo em 22% do histórico importado, por nome traduzido ou boss desconhecido.
   * Quem consome trata nulo como "não deu para identificar", nunca como erro.
   */
  encounterId: z.string().nullable(),

  /** Nulo quando não deu para determinar. Lacuna, nunca `normal` por omissão. */
  difficulty: raidDifficultyLevelSchema.nullable(),

  /**
   * A resposta, no vocabulário do sistema.
   *
   * Slug, e não enum fechado: as opções são uma tabela configurável, e quem valida
   * é a linha em `LootResponseOption`.
   */
  responseOptionSlug: lootResponseSlugSchema,

  /** Zero é resultado legítimo; nulo é fonte que não tem o conceito de voto. */
  votes: z.number().int().nonnegative().nullable(),

  note: z.string().nullable(),
});
export type LootLine = z.infer<typeof lootLineSchema>;
