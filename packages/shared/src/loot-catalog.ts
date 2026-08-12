import { z } from 'zod';
import { primaryStatSchema, raidDifficultyLevelSchema, wowSpecSchema } from './wow.js';

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
export const wowItemSchema = z.object({
  itemId: z.number().int().positive(),

  /** Canônico em en_US. A tela lê daqui, nunca o nome gravado na linha de loot. */
  name: z.string().nullable(),

  /** Slug (`inv_helm_plate_raidwarrior_a_01`), não URL. */
  icon: z.string().nullable(),

  /** Slot na grafia da API REST (`TRINKET`, `HEAD`). NÃO é `INVTYPE_*`, que é a do cliente. */
  equipLoc: z.string().nullable(),

  /** Subclasse: `Plate`, `Trinket`, `One-Handed Sword`. */
  itemSubclass: z.string().nullable(),

  /**
   * Stats primários da peça. Cadastrado à mão — ver `primaryStatSchema`.
   *
   * Vazio é resposta legítima: existe trinket que é só efeito.
   */
  primaryStats: primaryStatSchema.array(),

  /**
   * Quais specs podem usar a peça.
   *
   * ESTA LISTA SUBSTITUI A DERIVAÇÃO, NUNCA SOMA A ELA. Derivar por armadura,
   * stat e slot dá uma boa proposta, mas erra num caso que não é raro: o efeito
   * do item restringe além do que o stat diz. Trinket com intelecto e proc de
   * cura serve healer e não serve mago; trinket com força e redução de dano
   * serve tank e não serve Fury.
   *
   * Como as restrições reais são de REMOÇÃO, um desenho "derivado + acréscimos"
   * não conseguiria expressar nenhum desses casos. Por isso o que fica gravado é
   * a resposta final do humano. Ver TIT-77.
   */
  usableBySpecs: wowSpecSchema.array(),

  /**
   * Quando um humano revisou `usableBySpecs`. Nulo = ninguém revisou ainda.
   *
   * Existe para separar duas coisas que a lista vazia confunde: "ainda não
   * sabemos" e "nenhuma spec usa". Mesmo princípio da Regra 7 — falha de coleta
   * é lacuna, nunca zero. Sem este campo, item recém-cadastrado apareceria como
   * inútil para todo mundo.
   */
  specsCuratedAt: z.string().datetime().nullable(),
});
export type WowItem = z.infer<typeof wowItemSchema>;

/** O que um boss solta numa dificuldade. */
export const encounterDropSchema = z.object({
  difficulty: raidDifficultyLevelSchema,
  item: wowItemSchema,
});
export type EncounterDrop = z.infer<typeof encounterDropSchema>;

export const lootCatalogEncounterSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Ordem em que se mata na raid. */
  position: z.number().int(),

  /**
   * `dungeonEncounterID` do jogo — o mesmo id que o Warcraft Logs usa.
   *
   * Vai no contrato porque o cadastro do catálogo confere este número contra o
   * WCL (o WCL responde o nome do boss a partir do id), e quem cadastra precisa
   * vê-lo na tela para conferir.
   *
   * Nulo enquanto ninguém preencheu.
   */
  dungeonEncounterId: z.number().int().nullable(),

  drops: encounterDropSchema.array(),
});
export type LootCatalogEncounter = z.infer<typeof lootCatalogEncounterSchema>;

export const lootCatalogRaidSchema = z.object({
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

  /**
   * `instanceMapID` do cliente. Conferência, não chave de casamento.
   *
   * NÃO comparar com a zona do Warcraft Logs: Aberrus é `2569` aqui e zona `33`
   * lá. Só o id de encounter coincide entre as duas fontes.
   */
  instanceMapId: z.number().int().nullable(),

  encounters: lootCatalogEncounterSchema.array(),
});
export type LootCatalogRaid = z.infer<typeof lootCatalogRaidSchema>;

/**
 * A raid sem os drops, para a lista.
 *
 * Existe por tamanho de resposta, medido no endpoint: a resposta repete o item em
 * cada dificuldade, e as quatro raids do tier corrente dão 468 drops com ~10 mil
 * strings de spec. Isso é **306 KB** completo contra **553 bytes** resumido, e
 * cresce um tier por vez.
 *
 * Quem precisa dos drops quer **uma** raid — 173 KB no caso do Voidspire, ou
 * 58 KB filtrando uma dificuldade — então a lista devolve só o suficiente para
 * escolher qual.
 *
 * Derivado do schema completo com `omit`, e não redeclarado: campo novo na raid
 * aparece nos dois de graça, em vez de divergir calado.
 */
export const lootCatalogRaidSummarySchema = lootCatalogRaidSchema
  .omit({ encounters: true })
  .extend({
    /** Quantos bosses a raid tem. A lista mostra, sem carregar os drops. */
    encounterCount: z.number().int().nonnegative(),
  });
export type LootCatalogRaidSummary = z.infer<typeof lootCatalogRaidSummarySchema>;
