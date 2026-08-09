import { z } from 'zod';

/**
 * Dificuldade de raid como o catálogo a define.
 *
 * É **contexto da entrada do catálogo**, não algo derivado do item. Foi testado
 * nos 445 registros da season passada: dos 112 itens de raid, 75 aparecem em
 * mais de uma dificuldade, e só um bonus ID separa limpo. Quem cadastra está
 * lendo a loot table Mítica no Wowhead e já sabe que é mítica — não há o que
 * reverter.
 *
 * Os valores são **identidade estável**, nunca posição. Isso é deliberado: o
 * `responseID` do RCLootCouncil é posicional, e no export real o id `2` aparece
 * como "Big" e como "Banking" porque alguém reordenou os botões. A armadilha não
 * se repete em casa.
 *
 * NÃO CONFUNDIR com o `raidDifficultySchema` de `raid-progress.ts`. Aquele é a
 * dificuldade **numerada pelo Warcraft Logs** (`{ id: 5, name: 'Mythic' }`), um
 * identificador de fonte externa que a gente recebe e repassa. Este é o nosso
 * enum canônico, que a gente escolhe e controla. São conceitos diferentes com o
 * mesmo nome em português, e o sufixo `Level` existe só para não deixar os dois
 * se confundirem no autocomplete.
 */
export const raidDifficultyLevelSchema = z.enum(['normal', 'heroic', 'mythic']);
export type RaidDifficultyLevel = z.infer<typeof raidDifficultyLevelSchema>;

/**
 * Item do dicionário — "o que é o item 249276".
 *
 * Não é a loot table (isso é o drop). O dicionário cobre **qualquer** itemID que
 * o sistema vir, inclusive M+ e bonus roll, que nunca estarão numa loot table de
 * boss.
 *
 * Nome, ícone e slot são nuláveis porque vêm do enriquecimento pela API da
 * Blizzard, e item de patch não lançado responde 404 — o cadastro precisa
 * funcionar antes disso.
 */
export const catalogItemSchema = z.object({
  itemId: z.number().int().positive(),

  /** Canônico em en_US. A tela lê daqui, nunca o nome gravado na linha de loot. */
  name: z.string().nullable(),

  /** Slug (`inv_helm_plate_raidwarrior_a_01`), não URL. */
  icon: z.string().nullable(),

  /** `INVTYPE_*`: o slot. Constante da Blizzard, não localizada. */
  equipLoc: z.string().nullable(),

  /** Subclasse: `Plate`, `Trinket`, `One-Handed Sword`. */
  itemSubclass: z.string().nullable(),
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;

/** O que um boss solta numa dificuldade. */
export const encounterDropSchema = z.object({
  difficulty: raidDifficultyLevelSchema,
  item: catalogItemSchema,
});
export type EncounterDrop = z.infer<typeof encounterDropSchema>;

export const catalogEncounterSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Ordem em que se mata na raid. */
  position: z.number().int(),
  drops: encounterDropSchema.array(),
});
export type CatalogEncounter = z.infer<typeof catalogEncounterSchema>;

export const catalogRaidSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),

  /**
   * Season da Blizzard, ou nulo.
   *
   * Nulo é estado legítimo, não erro: a `GameSeason` só existe depois que a
   * season começa, e o catálogo é cadastrado antes disso. Quem consome tem que
   * tratar nulo como "ainda não ligada", nunca como dado faltando.
   */
  seasonId: z.number().int().nullable(),

  encounters: catalogEncounterSchema.array(),
});
export type CatalogRaid = z.infer<typeof catalogRaidSchema>;
