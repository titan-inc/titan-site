import { z } from 'zod';
import { lootCharacterSchema } from './loot-line.js';
import { lootResponseKindSchema } from './loot-response.js';
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
   * A season em que a entrega aconteceu — o filtro principal da aba.
   *
   * **Ausente significa "todas as seasons"**, que é uma opção legítima da tela e
   * não um estado de erro. A tela abre na season mais recente e manda o id; quem
   * escolhe "todas" simplesmente não manda o parâmetro.
   *
   * Linha sem season (lacuna) só aparece em "todas" — pedir uma season é pedir o
   * que se sabe estar nela.
   */
  season: z.coerce.number().int().positive().optional(),

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
 * por nome traduzido ou boss `Unknown`. Desde a TIT-130 não há fallback para
 * texto de outra ferramenta: `name` e `raid` ficam nulos junto, e a tela mostra
 * a lacuna. Não é regressão — o `rawBoss`/`rawInstance` que preenchiam isto
 * antes eram, em 56 de 77 casos, o próprio `Unknown`/`Desconhecido` da fonte com
 * cara de dado nosso. O bruto original continua acessível em `rawImportedLine`.
 */
export const lootHistoryBossSchema = z.object({
  encounterId: z.string().nullable(),
  name: z.string().nullable(),
  raid: z.string().nullable(),
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

  /**
   * O `kind` congelado no momento da entrega — nunca o kind atual da opção.
   *
   * É o que a tela usa para não ler linha de `loot_master` como "X levou": uma
   * entrega de banco é "foi para o banco, guardado por X", não um recebimento.
   */
  responseKind: lootResponseKindSchema,

  /** Zero é resultado; nulo é fonte que não tem o conceito de voto. */
  votes: z.number().int().nonnegative().nullable(),

  /** A nota de quem pediu a peça. Ver `LootLine.playerNote`. */
  playerNote: z.string().nullable(),
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

/**
 * Os valores que os filtros podem assumir — as opções dos seletores da tela.
 *
 * Existe porque a API aceita filtrar por personagem, boss e slot mas não diz
 * quais existem, e sem isso a tela vira campo de texto livre. Digitar
 * `Shrëwd-Area52` com o trema certo não é filtro, é adivinhação: é a Regra 6
 * batendo na interface.
 *
 * **Só o que de fato aparece no histórico.** Um filtro que devolve zero não é
 * oferecido, então nenhuma combinação da tela leva a uma tela vazia por engano.
 *
 * Cada opção traz `total` para a tela poder mostrar o peso de cada uma antes do
 * clique.
 */
export const lootHistoryFacetsSchema = z.object({
  /**
   * TODAS as seasons que têm histórico, independente da selecionada — é o
   * seletor de season, e ele precisa oferecer para onde ir.
   *
   * `id` nulo é a fatia sem season: linhas que não deu para datar. Aparece só
   * quando existe alguma, e é lacuna visível em vez de linha sumida.
   */
  seasons: z.array(
    z.object({
      id: z.number().int().positive().nullable(),
      name: z.string(),
      total: z.number().int().nonnegative(),
    }),
  ),

  /** Personagens da season selecionada, com a grafia da fonte para exibir. */
  characters: z.array(
    z.object({
      name: z.string(),
      realm: z.string(),
      /** `Nome-Realm`, pronto para mandar de volta no filtro `character`. */
      value: z.string(),
      total: z.number().int().nonnegative(),
    }),
  ),

  bosses: z.array(
    z.object({
      encounterId: z.string(),
      name: z.string(),
      raid: z.string(),
      total: z.number().int().nonnegative(),
    }),
  ),

  slots: z.array(z.object({ equipLoc: z.string(), total: z.number().int().nonnegative() })),
});
export type LootHistoryFacets = z.infer<typeof lootHistoryFacetsSchema>;
