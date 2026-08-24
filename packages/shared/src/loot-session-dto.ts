import { z } from 'zod';
import { itemViewSchema } from './item-view.js';
import { notaSchema } from './nota.js';
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

  /**
   * O motivo por trás do rótulo. Opcional, e editável junto da resposta.
   *
   * **Ausente mantém, vazio apaga.** Se omitir apagasse, um cliente que
   * mandasse só a escolha limparia a nota da pessoa em silêncio.
   */
  note: notaSchema.optional(),
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

  /** O que a pessoa escreveu junto da escolha. Nula quando não escreveu. */
  note: z.string().nullable(),

  characterName: z.string(),
});
export type MinhaResposta = z.infer<typeof minhaRespostaSchema>;

/**
 * A resposta de OUTRA pessoa, como o membro passa a ver quando as respostas
 * fecham.
 *
 * Só existe em `deliberando`. Na fase de roll a lista vem vazia, e cada um vê
 * apenas o próprio `minhaResposta` — ver TIT-131.
 *
 * **Sem voto.** Contagem de voto e histórico de peças recebidas continuam só no
 * painel, atrás do `OfficerGuard`: o membro passa a acompanhar o que a sala
 * declarou, não como o conselho está decidindo.
 */
export const respostaNaSessaoSchema = z.object({
  name: z.string(),
  realm: z.string(),

  /** `noop` é quem estava na sessão e não se manifestou. */
  responseOptionSlug: z.string(),

  /** Nulo em `noop`: quem não respondeu nunca rolou. */
  roll: z.number().int().nullable(),

  /** O que a pessoa escreveu ao pedir. Segue a mesma fase da resposta. */
  note: z.string().nullable(),
});
export type RespostaNaSessao = z.infer<typeof respostaNaSessaoSchema>;

/**
 * Uma peça da sessão, pronta para a tela.
 *
 * O item em si (nome, ícone, `itemString`, `ComputedItemStats`) vem do
 * `itemViewSchema` unificado (TIT-135) — este schema só acrescenta o que é
 * da SESSÃO, não do item: posição na colagem, quem lootou, a resposta.
 *
 * `itemContext`/`bonusIds`, que existiam aqui separados, saem: eram
 * derivados do `itemString` só para a tela reconstruir a união de bônus, e
 * `ComputedItemStats` já entrega essa união decodificada (`track`,
 * `dificuldade`, `sockets`, `desconhecidos`) — sem consumidor, viraram
 * duplicata do mesmo dado em forma crua.
 */
export const lootSessionItemViewSchema = itemViewSchema.extend({
  id: z.string(),

  /** Ordem na colagem. É o que distingue duas cópias do mesmo item. */
  position: z.number().int().positive(),

  /** Quem lootou NO JOGO. Entrada para a decisão, nunca o resultado dela. */
  looterName: z.string().nullable(),
  looterRealm: z.string().nullable(),

  /** A resposta de quem está olhando. Nula enquanto a pessoa não respondeu. */
  minhaResposta: minhaRespostaSchema.nullable(),

  /**
   * Quantas pessoas já responderam a esta peça.
   *
   * Na fase de roll é tudo que se sabe das outras pessoas: dá a noção de que a
   * sala está andando sem entregar o conteúdo do que elas declararam.
   */
  totalDeRespostas: z.number().int().nonnegative(),

  /**
   * O que TODO MUNDO declarou. **Vazio até as respostas fecharem.**
   *
   * Em `deliberando` a informação já está tomada — ninguém responde mais, só
   * quem for reaberto —, então mostrar não muda mais declaração nenhuma, e a
   * raid inteira acompanha em vez de esperar o resultado (Regra 7).
   *
   * Na fase de roll vem vazio, e quem garante isso é a API: uma tela que
   * escondesse o que o payload carrega seria enfeite, com o conteúdo a um F12
   * de distância de qualquer pessoa da raid. Ver TIT-131.
   */
  respostas: z.array(respostaNaSessaoSchema),
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

  /**
   * Os botões que o jogador tem para responder, na ordem da tela.
   *
   * Vêm junto da sessão, e não de um endpoint próprio, por dois motivos: a tela
   * precisa dos dois na mesma hora, e assim o botão que ela mostra é
   * necessariamente o que a API aceita — a lista é configurável (TIT-64), e
   * duas fontes divergiriam no dia em que a liderança desativar uma opção.
   *
   * Só as de `kind = player`. Razão de loot master (`banking`, `disenchant`,
   * `no_interest`) é decisão de destino, e `noop` é derivada pelo sistema —
   * nenhuma das duas é coisa que alguém declare.
   */
  opcoesDeResposta: z.array(z.object({ slug: z.string(), label: z.string() })),

  /**
   * `MAX(WowBonus.trackScalingId)` do build ativo — TIT-135. Quem decide se
   * a contagem `4/6` de `ComputedItemStats.track` aparece é a TELA,
   * comparando `track.scalingId` com este número; sem ele o browser não tem
   * como saber qual é a season corrente (Regra 1 — só o Nest toca banco).
   *
   * `null` quando o build ativo não tem nenhum bonus com track — nenhuma
   * peça da sessão mostra contagem.
   */
  trackScalingIdAtual: z.number().int().nullable(),
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
