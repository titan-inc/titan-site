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

/**
 * Entrar na sessão, com o personagem daquela noite.
 *
 * **Ato explícito**, e não consequência de abrir a tela: quem abre a sessão pelo
 * celular durante o jantar não está na raid, e entrar por engano colocaria a
 * pessoa na lista de candidatos à peça de alguém.
 *
 * O personagem tem que ser um dos da conta no roster. Entrar de novo com outro
 * troca o personagem — ninguém raida em dois ao mesmo tempo.
 */
export const entrarNaSessaoSchema = z.object({
  characterName: z.string().min(1),
  characterRealm: z.string().min(1),
});
export type EntrarNaSessao = z.infer<typeof entrarNaSessaoSchema>;

/** Quem está na sessão, e com qual personagem. */
export const participanteSchema = z.object({
  name: z.string(),
  realm: z.string(),
  nameKey: z.string(),
  realmKey: z.string(),
  battletag: z.string(),
  joinedAt: z.string().datetime(),
});
export type Participante = z.infer<typeof participanteSchema>;

/**
 * O que o jogador declara para uma peça.
 *
 * **O personagem não entra aqui.** Ele vem da participação, que é onde a pessoa
 * já disse com qual char está naquela noite. Antes era opcional e caía no
 * representante da conta, que erra justamente para quem raida no alt — e o erro
 * é silencioso: a resposta entra no char errado e ninguém recebe aviso.
 *
 * **O roll também não.** Ele é do servidor, e aceitar do cliente deixaria mandar
 * 100.
 */
export const respondToLootItemSchema = z.object({
  responseOptionSlug: z.string().min(1),
});
export type RespondToLootItem = z.infer<typeof respondToLootItemSchema>;

/**
 * A resposta de quem está olhando, para uma peça.
 *
 * **Só a própria.** Sessão é privada por padrão: cada pessoa vê a própria
 * resposta e o próprio roll. É exceção consciente à Regra 7 — ali o histórico de
 * loot é aberto, mas durante a deliberação ver a resposta alheia muda o que as
 * pessoas declaram.
 */
export const minhaRespostaSchema = z.object({
  responseOptionSlug: z.string(),

  /**
   * 1 a 100, do servidor, imutável.
   *
   * Nasce na PRIMEIRA resposta e não muda mais — nem ao trocar a resposta, nem
   * quando o conselho pede para responder de novo. Sem isso, trocar a resposta
   * viraria rerrolar até gostar do número, e "responda de novo" viraria uma
   * forma de o conselho garimpar roll para o favorito.
   *
   * Nulo é quem não rolou, e só acontece no `noop` — a linha que registra
   * silêncio de quem estava na sessão. Nunca zero: zero apareceria ao lado de
   * quem rolou 1 parecendo roll ruim, e não ausência de roll.
   */
  roll: z.number().int().nullable(),

  /** O conselho pediu para esta pessoa responder de novo. */
  aguardandoNovaResposta: z.boolean(),

  characterName: z.string(),
});
export type MinhaResposta = z.infer<typeof minhaRespostaSchema>;

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

  /** A resposta de quem está olhando. Nula enquanto a pessoa não respondeu. */
  minhaResposta: minhaRespostaSchema.nullable(),

  /**
   * Quantas pessoas já responderam a esta peça.
   *
   * Só a contagem, nunca quem nem o quê: dá ao jogador a noção de que a sala
   * está andando sem entregar o conteúdo das respostas alheias.
   */
  totalDeRespostas: z.number().int().nonnegative(),
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

  /**
   * Quem está na sessão. Aberto a todo mundo que participa.
   *
   * Diferente da RESPOSTA alheia, que fica escondida enquanto a sessão corre:
   * quem está na raid não é segredo — as pessoas se veem no jogo. O que muda
   * comportamento é ver o que os outros declararam, não quem entrou.
   */
  participantes: z.array(participanteSchema),

  /** A própria participação. Nula para quem ainda não entrou. */
  minhaParticipacao: participanteSchema.nullable(),
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
