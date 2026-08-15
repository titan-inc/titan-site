import { z } from 'zod';

/**
 * O painel do conselho.
 *
 * **Endpoint próprio, e não um campo do detalhe da sessão.** Se fosse campo, o
 * payload do membro carregaria as respostas de todo mundo e a tela só
 * esconderia — o oposto da Regra 5, onde o teste é "chamado sem permissão
 * devolve 403?".
 *
 * Na tela, é a metade de cima, colapsável. Colapsado, o que sobra é próximo do
 * que a raid inteira vê — o loot master enxerga a sessão como ela é enxergada,
 * sem precisar de outra conta.
 */

/**
 * Uma peça que o candidato já recebeu.
 *
 * **Não é o explorador.** É recorte mínimo justificado pelo ato de decidir: o
 * conselho precisa saber o que a pessoa já levou para não dar a quinta peça da
 * noite a quem já levou quatro. Quem quer o histórico inteiro abre a aba de
 * Histórico, que é aberta a todo mundo da área interna.
 */
export const recebidoAntesSchema = z.object({
  awardedAt: z.string().datetime(),

  /** Do catálogo. Nulo quando o item ainda não foi enriquecido. */
  itemName: z.string().nullable(),
  icon: z.string().nullable(),

  /** `HEAD`, `TRINKET`. É o que responde "ela já levou anel esta semana?". */
  equipLoc: z.string().nullable(),

  difficulty: z.string().nullable(),

  /** O que ela declarou na época. `bis` pesa diferente de `transmog`. */
  responseOptionSlug: z.string(),
});
export type RecebidoAntes = z.infer<typeof recebidoAntesSchema>;

/**
 * Uma pessoa na disputa de uma peça: o que declarou, o que tirou, e o que o
 * conselho fez.
 *
 * **É todo participante da sessão, não só quem respondeu.** Silêncio de quem
 * estava na raid é informação para quem decide, e esconder a linha faria a
 * lista parecer menor do que a raid — quem decide precisa saber que perguntou a
 * 25 pessoas e 6 não disseram nada.
 */
export const candidatoSchema = z.object({
  /** O par nome + realm, na grafia que a pessoa usa. */
  name: z.string(),
  realm: z.string(),

  /** Pronto para mandar de volta nas ações do conselho. */
  nameKey: z.string(),
  realmKey: z.string(),

  /**
   * O que a pessoa declarou. **Nulo é quem ainda não se manifestou.**
   *
   * Nulo e `noop` dizem coisas diferentes no tempo: nulo é silêncio provisório,
   * com a sessão aberta e a pessoa ainda podendo responder; `noop` é o silêncio
   * já registrado, materializado quando a fase de roll fechou. Nenhum dos dois é
   * `pass`, que é declaração — a pessoa olhou a peça e abriu mão.
   */
  responseOptionSlug: z.string().nullable(),

  /**
   * Imutável desde a primeira resposta — ver TIT-65.
   *
   * **Auxílio visual, nunca critério de decisão.** Está na tela para o conselho
   * olhar, do mesmo jeito que `recebidoAntes`. Nada no sistema entrega peça por
   * causa dele: quem decide é a mão do loot master ou a contagem de votos.
   *
   * Nulo é quem não rolou — quem não respondeu nunca rolou. Nunca zero: zero
   * apareceria ao lado de quem tirou 1 parecendo roll ruim.
   */
  roll: z.number().int().nullable(),

  /** O conselho pediu para esta pessoa responder de novo, e ela ainda não. */
  aguardandoNovaResposta: z.boolean(),

  /** Quantos conselheiros votaram nesta pessoa para esta peça. */
  votos: z.number().int().nonnegative(),

  /** Este conselheiro votou nela? Um voto por conselheiro por peça. */
  meuVoto: z.boolean(),

  /**
   * O que esta pessoa já recebeu, mais recente primeiro.
   *
   * É o que resolve o conselho votar cego. Vazio significa **nada no histórico**
   * — e isso é informação forte, não ausência de dado: alguém que nunca levou
   * nada tem argumento.
   */
  recebidoAntes: z.array(recebidoAntesSchema),
});
export type Candidato = z.infer<typeof candidatoSchema>;

/**
 * Quem levou a peça.
 *
 * A resposta e a contagem de votos ficam **congeladas no momento do award** —
 * depois disso a resposta pode ser corrigida, e o histórico tem que guardar o
 * que valia quando a decisão foi tomada, não o que ficou depois.
 */
export const awardDaPecaSchema = z.object({
  winnerName: z.string(),
  winnerRealm: z.string(),
  responseOptionSlug: z.string(),
  votes: z.number().int().nonnegative(),
  awardedByBattletag: z.string(),
  awardedAt: z.string().datetime(),
});
export type AwardDaPeca = z.infer<typeof awardDaPecaSchema>;

/** Uma peça em disputa, do ponto de vista de quem decide. */
export const itemDoPainelSchema = z.object({
  itemId: z.string(),

  /**
   * Ordenados por voto, depois por roll.
   *
   * A ordem é sugestão de leitura, nunca decisão: quem escolhe é o conselho, e
   * o sistema que decide sozinho a reputação de alguém erra em público — Regra 7.
   */
  candidatos: z.array(candidatoSchema),

  /** Nulo enquanto ninguém levou. Preenchido, a peça está resolvida. */
  award: awardDaPecaSchema.nullable(),
});
export type ItemDoPainel = z.infer<typeof itemDoPainelSchema>;

/** O painel inteiro. */
export const lootCouncilPanelSchema = z.object({
  sessionId: z.string(),

  /** Quem abriu a sessão. É o loot master dela — não existe papel separado. */
  lootMasterBattletag: z.string(),

  itens: z.array(itemDoPainelSchema),
});
export type LootCouncilPanel = z.infer<typeof lootCouncilPanelSchema>;

/** Identifica um personagem numa ação do conselho. */
export const alvoDaAcaoSchema = z.object({
  characterName: z.string().min(1),
  characterRealm: z.string().min(1),
});

/**
 * O voto do conselheiro numa peça.
 *
 * Um voto por conselheiro por peça, apontando para um candidato. Votar de novo
 * troca o voto — é o mesmo `UNIQUE` que impede dois votos, e a troca fica no log.
 */
export const votarSchema = alvoDaAcaoSchema;
export type Votar = z.infer<typeof votarSchema>;

/**
 * O conselho pede para alguém responder de novo.
 *
 * Mesma ação para duas situações: quem respondeu e o conselho quer outra
 * resposta, e quem nunca respondeu e o conselho quer trazer para a disputa. No
 * segundo caso a linha nasce aqui, esperando resposta.
 *
 * É o que destrava a deliberação: desde a TIT-65, resposta em `deliberando` só
 * entra para quem foi reaberto.
 */
export const reabrirRespostaSchema = alvoDaAcaoSchema;
export type ReabrirResposta = z.infer<typeof reabrirRespostaSchema>;

/**
 * O conselho corrige a resposta de alguém.
 *
 * Existe porque a pessoa erra o botão com 25 esperando. **Vira evento com
 * autor**, separado de `resposta_dada`: "o que eu declarei" e "o que mudaram no
 * que eu declarei" são perguntas diferentes na auditoria, e "quem mudou meu
 * voto?" precisa ter resposta.
 *
 * Não mexe no roll. Nada mexe no roll depois da primeira resposta.
 */
export const alterarRespostaSchema = alvoDaAcaoSchema.extend({
  responseOptionSlug: z.string().min(1),
});
export type AlterarResposta = z.infer<typeof alterarRespostaSchema>;

/** O conselho entrega a peça a uma pessoa específica. */
export const awardarSchema = alvoDaAcaoSchema;
export type Awardar = z.infer<typeof awardarSchema>;

/**
 * Entrega por maioria: a peça vai para quem tem mais votos do conselho.
 *
 * Com `itemId`, uma peça; sem, **todas as que ainda não foram entregues**. São a
 * mesma regra aplicada a um item ou a todos — separar em duas rotas duplicaria a
 * parte delicada, que é quando a contagem NÃO decide.
 *
 * **Não existe decisão automática.** Peça só ganha dono pela mão do loot master
 * ou pela contagem de votos, que também é decisão do conselho. Sem voto não sai
 * peça, nem com um candidato só; empate de votos volta para a mão. O roll não
 * desempata — ele é auxílio visual, ver `candidatoSchema`.
 */
export const awardPorMaioriaSchema = z.object({
  itemId: z.string().min(1).optional(),
});
export type AwardPorMaioria = z.infer<typeof awardPorMaioriaSchema>;

/**
 * O que a entrega em massa fez, peça por peça.
 *
 * Traz os pulos com o motivo, em vez de só o total: entregar 3 de 7 sem dizer o
 * que houve com as outras 4 faria o loot master descobrir na hora de encerrar.
 */
export const awardEmMassaResultadoSchema = z.object({
  entregues: z.number().int().nonnegative(),
  pulados: z.array(z.object({ itemId: z.string(), motivo: z.string() })),
});
export type AwardEmMassaResultado = z.infer<typeof awardEmMassaResultadoSchema>;
