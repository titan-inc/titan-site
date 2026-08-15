import { z } from 'zod';
import { lootSessionStatusSchema } from './loot-session.js';
import { raidDifficultyLevelSchema } from './wow.js';

/**
 * O que o loot master manda para criar a sessão: a colagem crua do addon.
 *
 * Texto, e não a colagem já parseada: quem interpreta é a API, pela Regra 1.
 * Parsing é regra de negócio, não coisa de browser — e assim o front não precisa
 * saber nada sobre o formato do addon.
 */
export const createLootSessionSchema = z.object({
  paste: z.string().min(1),
});
export type CreateLootSession = z.infer<typeof createLootSessionSchema>;

/**
 * Uma peça acrescentada à mão.
 *
 * Existe porque disconnect no instante do drop existe, e o addon perde. O
 * caminho manual é correção, não o fluxo normal.
 */
export const addLootSessionItemSchema = z.object({
  itemString: z.string().min(1),
  looterName: z.string().optional(),
  looterRealm: z.string().optional(),
});
export type AddLootSessionItem = z.infer<typeof addLootSessionItemSchema>;

/**
 * Para onde a sessão vai.
 *
 * Um corpo com o destino, e não uma rota por transição (`/abrir`,
 * `/deliberar`): quem decide o que é permitido é `podeTransicionar()`, e uma
 * rota por transição espalharia a mesma regra por quatro lugares.
 */
export const changeLootSessionStatusSchema = z.object({
  status: lootSessionStatusSchema,
});
export type ChangeLootSessionStatus = z.infer<typeof changeLootSessionStatusSchema>;

/** Uma peça da sessão, pronta para a tela. */
export const lootSessionItemViewSchema = z.object({
  id: z.string(),

  /** Ordem na colagem. É o que distingue duas cópias do mesmo item. */
  position: z.number().int().positive(),

  itemId: z.number().int().positive(),

  /**
   * O `itemString` cru, inteiro.
   *
   * Vai para a tela porque duas peças com o mesmo `itemID` podem ser coisas
   * diferentes — observado em raid real, mesmo boss: duas cópias de `202593`
   * com bônus `9415` e `9414`. Sem isso o conselho vê duas linhas idênticas.
   */
  itemString: z.string(),

  /** Derivados do `itemString`. `itemContext` nulo é "não sei", nunca zero. */
  itemContext: z.number().int().nullable(),
  bonusIds: z.array(z.number().int()),

  /**
   * Nome e ícone do catálogo. Nulos quando o item ainda não foi enriquecido —
   * a linha existe mesmo assim, e a tela mostra o id.
   */
  name: z.string().nullable(),
  icon: z.string().nullable(),
  equipLoc: z.string().nullable(),

  /** Quem lootou NO JOGO. Entrada para a decisão, nunca o resultado dela. */
  looterName: z.string().nullable(),
  looterRealm: z.string().nullable(),
});
export type LootSessionItemView = z.infer<typeof lootSessionItemViewSchema>;

/** De onde a sessão saiu. */
export const lootSessionEncounterSchema = z.object({
  /** Id do boss no catálogo. Nulo quando o boss não está cadastrado. */
  encounterId: z.string().nullable(),

  /** Nome do catálogo quando casou; senão a grafia localizada da colagem. */
  name: z.string(),

  /** Raid do catálogo quando casou; senão a grafia localizada da colagem. */
  raid: z.string(),
});

/** A sessão inteira. */
export const lootSessionDetailSchema = z.object({
  id: z.string(),
  status: lootSessionStatusSchema,

  encounter: lootSessionEncounterSchema,

  /** Convertida do `difficultyID` do cliente. Nula fora de raid organizada. */
  difficulty: raidDifficultyLevelSchema.nullable(),

  createdByBattletag: z.string(),
  createdAt: z.string().datetime(),
  openedAt: z.string().datetime().nullable(),

  items: z.array(lootSessionItemViewSchema),
});
export type LootSessionDetail = z.infer<typeof lootSessionDetailSchema>;

/**
 * O resultado de criar a sessão.
 *
 * Traz os problemas junto de propósito: linha torta não derruba a colagem, e o
 * loot master precisa ver o que não entrou para acrescentar à mão. Esconder
 * transformaria perda silenciosa em surpresa na hora de awardar.
 */
export const createLootSessionResultSchema = z.object({
  session: lootSessionDetailSchema,
  problemas: z.array(z.object({ linha: z.number().int().positive(), motivo: z.string() })),
});
export type CreateLootSessionResult = z.infer<typeof createLootSessionResultSchema>;

/** Uma sessão na lista — o suficiente para a aba de Sessão escolher. */
export const lootSessionSummarySchema = z.object({
  id: z.string(),
  status: lootSessionStatusSchema,
  encounterName: z.string(),
  raidName: z.string(),
  difficulty: raidDifficultyLevelSchema.nullable(),
  itemCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type LootSessionSummary = z.infer<typeof lootSessionSummarySchema>;
