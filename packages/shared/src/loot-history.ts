import { z } from 'zod';
import { lootCharacterSchema } from './loot-line.js';
import { raidDifficultyLevelSchema } from './wow.js';

/** Teto de página. Existe para uma query solta não varrer o histórico inteiro. */
export const LOOT_HISTORY_MAX_PAGE_SIZE = 200;

/**
 * Filtros do explorador de histórico.
 *
 * Combináveis, todos opcionais — sem filtro nenhum é "tudo, mais recente
 * primeiro", que é a tela de entrada.
 *
 * Vem de query string, então tudo chega como texto: `page` e `pageSize` usam
 * `coerce`. Filtro ausente e filtro vazio dão no mesmo, porque `?boss=` é o que
 * um `<select>` sem seleção manda.
 */
export const lootHistoryQuerySchema = z.object({
  /**
   * `Nome-Realm`, no formato do cliente do jogo — `Fulano-Area52`.
   *
   * Um campo só, e não dois, porque é assim que o personagem é identificado em
   * toda fonte do jogo, e porque nome sem realm não identifica ninguém (Regra 6).
   */
  character: z.string().min(1).optional(),

  /** Janela por dia da entrega, inclusiva nas duas pontas. */
  from: z.string().date().optional(),
  to: z.string().date().optional(),

  /** Id do boss no catálogo. Só casa com linha que resolveu. */
  encounterId: z.string().min(1).optional(),

  difficulty: raidDifficultyLevelSchema.optional(),

  /** Slot na grafia da API REST — `HEAD`, `TRINKET`. Não localizado. */
  slot: z.string().min(1).optional(),

  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(LOOT_HISTORY_MAX_PAGE_SIZE).default(50),
});
export type LootHistoryQuery = z.infer<typeof lootHistoryQuerySchema>;

/**
 * O item, **sempre pelo catálogo** — nunca pelo `itemName` da linha.
 *
 * Aquele vem no idioma do cliente de quem era loot master, então o mesmo item
 * apareceria em dois idiomas na mesma lista. Ver TIT-49.
 *
 * Os campos são nuláveis porque o catálogo pode estar atrás do histórico: item
 * de uma season que ninguém cadastrou ainda entra na linha e fica sem nome. A
 * linha existe mesmo assim — histórico não espera catálogo.
 */
export const lootHistoryItemSchema = z.object({
  itemId: z.number().int().positive(),
  name: z.string().nullable(),
  icon: z.string().nullable(),
  equipLoc: z.string().nullable(),
});

/**
 * De onde a peça saiu.
 *
 * `encounterId` nulo é "não deu para identificar" — 26% do histórico importado,
 * por nome traduzido ou boss `Unknown`. Nesse caso `name` e `raid` caem para a
 * grafia da fonte, que é localizada e traz o sufixo de dificuldade colado
 * (`A Torre do Caos-Normal`). É feio e é honesto: é o que a fonte disse.
 */
export const lootHistoryBossSchema = z.object({
  encounterId: z.string().nullable(),
  name: z.string(),
  raid: z.string(),
});

/** Uma entrega, pronta para a tela. */
export const lootHistoryEntrySchema = z.object({
  id: z.string(),
  awardedAt: z.string().datetime(),

  winner: lootCharacterSchema,
  winnerClass: z.string().nullable(),

  item: lootHistoryItemSchema,
  boss: lootHistoryBossSchema,

  /** Dificuldade da **peça**, do `itemContext`. Nula quando não deu para saber. */
  difficulty: raidDifficultyLevelSchema.nullable(),

  /**
   * A resposta, com o texto de exibição junto.
   *
   * O `label` vem da tabela e é editável; o `slug` é a identidade imutável. A
   * tela mostra o primeiro e agrupa pelo segundo — trocar os dois de papel é o
   * erro que o `responseID` do RCLootCouncil cometia.
   */
  response: z.object({ slug: z.string(), label: z.string() }),

  /** Zero é resultado; nulo é fonte que não tem o conceito de voto. */
  votes: z.number().int().nonnegative().nullable(),
  note: z.string().nullable(),
});
export type LootHistoryEntry = z.infer<typeof lootHistoryEntrySchema>;

/**
 * Uma página do histórico.
 *
 * `total` é a contagem **com os filtros aplicados**, não o tamanho do histórico:
 * é o que a tela precisa para dizer "37 entregas" e para saber quantas páginas
 * existem.
 */
export const lootHistoryPageSchema = z.object({
  entries: z.array(lootHistoryEntrySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type LootHistoryPage = z.infer<typeof lootHistoryPageSchema>;
