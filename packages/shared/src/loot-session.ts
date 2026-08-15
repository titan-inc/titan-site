import { z } from 'zod';

/**
 * Ciclo de vida da sessão de loot council.
 *
 * Quatro estados, e não cinco: "awardada" **não é estado**, é consequência de
 * todo item estar resolvido. Guardar como flag criaria a chance de ela discordar
 * dos itens — mesmo defeito que a Regra 4 evita ao não gravar `isOfficer` na
 * conta.
 *
 * | estado        | quem age     | o que é mutável                          |
 * | ------------- | ------------ | ---------------------------------------- |
 * | `rascunho`    | loot master  | a lista de itens                         |
 * | `aberta`      | jogadores    | resposta de cada um; a lista congela     |
 * | `deliberando` | conselho     | votos; resposta só reabre a pedido       |
 * | `encerrada`   | ninguém      | nada — virou linha de histórico          |
 */
export const LOOT_SESSION_STATUS = {
  /** O loot master colou e ainda está corrigindo a lista. */
  RASCUNHO: 'rascunho',

  /** Jogadores respondendo. A lista de itens está congelada. */
  ABERTA: 'aberta',

  /** Respostas fechadas, conselho votando. */
  DELIBERANDO: 'deliberando',

  /** Acabou. Os itens viraram linha em `LootLine`. */
  ENCERRADA: 'encerrada',
} as const;

export const lootSessionStatusSchema = z.nativeEnum(LOOT_SESSION_STATUS);
export type LootSessionStatus = z.infer<typeof lootSessionStatusSchema>;

/**
 * Para onde cada estado pode ir.
 *
 * `deliberando → aberta` existe de propósito: o conselho pode reabrir as
 * respostas quando percebe que alguém não respondeu, ou que respondeu errado.
 * É a correção humana que a Regra 7 manda permitir, e sem ela o loot master
 * teria que refazer a sessão inteira por causa de uma pessoa.
 *
 * Não existe caminho de volta de `encerrada`: dali saiu histórico, e reabrir
 * significaria reescrever passado. Sessão encerrada por engano se resolve
 * corrigindo a linha de loot, não ressuscitando a sessão.
 */
const TRANSICOES: Readonly<Record<LootSessionStatus, readonly LootSessionStatus[]>> = {
  [LOOT_SESSION_STATUS.RASCUNHO]: [LOOT_SESSION_STATUS.ABERTA],
  [LOOT_SESSION_STATUS.ABERTA]: [LOOT_SESSION_STATUS.DELIBERANDO],
  [LOOT_SESSION_STATUS.DELIBERANDO]: [LOOT_SESSION_STATUS.ABERTA, LOOT_SESSION_STATUS.ENCERRADA],
  [LOOT_SESSION_STATUS.ENCERRADA]: [],
};

/** A transição é permitida? Estado igual conta como não — não é transição. */
export function podeTransicionar(de: LootSessionStatus, para: LootSessionStatus): boolean {
  return TRANSICOES[de].includes(para);
}

/** Para onde dá para ir a partir daqui. Vazio em `encerrada`. */
export function proximosEstados(de: LootSessionStatus): readonly LootSessionStatus[] {
  return TRANSICOES[de];
}

/** A lista de itens só muda no rascunho. Depois disso ela é o que foi anunciado. */
export function podeEditarItens(status: LootSessionStatus): boolean {
  return status === LOOT_SESSION_STATUS.RASCUNHO;
}

/**
 * A sessão ainda aceita resposta de alguém?
 *
 * **Não confundir com "esta pessoa pode responder agora".** Em `aberta`,
 * qualquer um responde e troca quantas vezes quiser. Em `deliberando`, só quem
 * o conselho reabriu — e essa parte depende do estado da resposta no banco
 * (`aguardandoNovaResposta`), então vive no serviço, não aqui.
 *
 * A primeira versão desta função dizia isso no comentário e o serviço não
 * checava nada: qualquer pessoa seguia trocando a resposta durante a
 * deliberação. Ninguém recebia erro. Se você está mexendo aqui, confira se o
 * gate por pessoa continua existindo do outro lado.
 */
export function sessaoAceitaResposta(status: LootSessionStatus): boolean {
  return status === LOOT_SESSION_STATUS.ABERTA || status === LOOT_SESSION_STATUS.DELIBERANDO;
}

/** Em `aberta` a resposta é livre; fora dela, depende de quem é. */
export function respostaLivre(status: LootSessionStatus): boolean {
  return status === LOOT_SESSION_STATUS.ABERTA;
}

/**
 * A sala já pode ver o que cada um declarou?
 *
 * **Não é permissão, é fase.** Vale igual para membro e para conselheiro, e a
 * razão é a mesma que fez a resposta alheia ficar escondida desde a TIT-65: ver
 * o que os outros declararam muda o que a pessoa declara. Quem ia pedir
 * `upgrade` vê três `bis` e desiste.
 *
 * Isso alcança o conselheiro porque **ele também é candidato** — conselho e loot
 * master raidam. Dar a ele escolha e roll durante a fase de roll seria dar a uma
 * parte da sala a informação que a outra não tem, na hora em que ela muda
 * decisão.
 *
 * Quando as respostas fecham, abre para todo mundo: ninguém responde mais (só
 * quem for reaberto), então mostrar não muda mais declaração nenhuma — e aí vale
 * a Regra 7, que quer a decisão do conselho acompanhável.
 *
 * O que continua sendo só do conselho é **voto** e histórico de peças recebidas.
 * Isto aqui decide o que a sala vê, não o que o conselho faz.
 */
export function respostasVisiveis(status: LootSessionStatus): boolean {
  return status === LOOT_SESSION_STATUS.DELIBERANDO || status === LOOT_SESSION_STATUS.ENCERRADA;
}

/** Conselho só vota depois que as respostas fecharam. */
export function podeVotar(status: LootSessionStatus): boolean {
  return status === LOOT_SESSION_STATUS.DELIBERANDO;
}

/**
 * O que aconteceu na sessão.
 *
 * O log é a **fonte da verdade**; as tabelas de estado são projeção escrita na
 * mesma transação e reconstruível a partir daqui. Se um dia divergirem, quem
 * está certo é o log.
 *
 * Existe porque três coisas dependem dele: auditoria ("quem mudou meu voto?"),
 * idempotência (o cliente manda um id e reenviar não duplica) e reconexão
 * ("eventos desde X" em vez de re-sincronizar tudo).
 */
export const LOOT_SESSION_EVENTS = {
  SESSAO_CRIADA: 'sessao_criada',
  ITEM_ADICIONADO: 'item_adicionado',
  ITEM_REMOVIDO: 'item_removido',
  STATUS_ALTERADO: 'status_alterado',

  /** Jogador declarou o que quer. O `roll` nasce junto e não muda. */
  RESPOSTA_DADA: 'resposta_dada',

  /**
   * Conselho trocou a resposta de alguém.
   *
   * Separado de `resposta_dada` de propósito: os dois mudam o mesmo campo, mas
   * respondem perguntas diferentes na auditoria — "o que eu declarei" e "o que
   * mudaram no que eu declarei".
   */
  RESPOSTA_ALTERADA: 'resposta_alterada',

  /** Conselho pediu para a pessoa responder de novo. */
  RESPOSTA_REABERTA: 'resposta_reaberta',

  VOTO_DADO: 'voto_dado',
  ITEM_AWARDADO: 'item_awardado',

  /** Alguém entrou na sessão, ou trocou o personagem com que entrou. */
  PARTICIPANTE_ENTROU: 'participante_entrou',

  /**
   * A fase de roll fechou e o silêncio virou linha.
   *
   * Um evento para a transição inteira, com a contagem — e não um por linha:
   * 25 pessoas por 5 peças seriam 125 eventos dizendo a mesma coisa, e o que a
   * auditoria precisa saber é quando o silêncio foi congelado, não item a item.
   */
  SILENCIO_REGISTRADO: 'silencio_registrado',
} as const;

export const lootSessionEventTypeSchema = z.nativeEnum(LOOT_SESSION_EVENTS);
export type LootSessionEventType = z.infer<typeof lootSessionEventTypeSchema>;

/**
 * O roll do jogador para um item.
 *
 * 1 a 100, **gerado pelo servidor** e imutável. Se fosse regerado a cada
 * resposta, dava para trocar de resposta até tirar um número bom; e se viesse do
 * cliente, dava para mandar 100.
 */
export const ROLL_MINIMO = 1;
export const ROLL_MAXIMO = 100;
export const rollSchema = z.number().int().min(ROLL_MINIMO).max(ROLL_MAXIMO);
