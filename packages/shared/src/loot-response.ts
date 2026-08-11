import { z } from 'zod';

/**
 * O que a pessoa respondeu quando levou o item.
 *
 * Vocabulário canônico do sistema, e o mesmo que a sessão ao vivo vai oferecer
 * nas opções configuráveis (TIT-64).
 *
 * **Append-only.** Um valor entra e nunca sai, mesmo que a sessão ao vivo pare de
 * oferecê-lo: o histórico importado continua precisando dele para descrever o que
 * aconteceu. Remover valor daqui é reescrever passado.
 *
 * **Identidade estável, nunca posição** — mesmo cuidado do enum de dificuldade e
 * da Regra 4. É justamente o erro que o `responseID` do RCLootCouncil comete, e
 * que esta tabela existe para não repetir: lá o `2` aparece como `Big` e como
 * `Banking`, porque é o índice do botão na config daquele raid.
 */
export const LOOT_RESPONSES = {
  /** Melhor peça possível para a spec. */
  BIS: 'bis',
  /** Upgrade relevante, sem ser o ideal. */
  UPGRADE: 'upgrade',
  /** Upgrade pequeno. */
  MINOR_UPGRADE: 'minor-upgrade',
  /** Serve para a spec secundária. */
  OFFSPEC: 'offspec',
  /** Só pela aparência. */
  TRANSMOG: 'transmog',
  /**
   * Declarou não querer — e ainda assim levou.
   *
   * Parece contradição e não é: num drop que ninguém quis, quem votou `pass`
   * levou por ter tirado o maior roll. Registro de 28/04/2026. Não é dado sujo,
   * então não é sanitizado na importação.
   */
  PASS: 'pass',
  /**
   * Foi para o banco da guilda, não para uma pessoa.
   *
   * É motivo de award e não declaração de interesse — o próprio RCLootCouncil o
   * marca com `isAwardReason=true`, e era o único rótulo assim nos 445 registros.
   * Fica no mesmo vocabulário porque continua sendo decisão do conselho sobre
   * aquele item.
   */
  BANKING: 'banking',
} as const;

export const lootResponseSchema = z.nativeEnum(LOOT_RESPONSES);
export type LootResponse = z.infer<typeof lootResponseSchema>;

/**
 * Combinação que o import reconhece e **descarta de propósito**.
 *
 * Existe como valor explícito, e não como ausência, porque descarte silencioso
 * seria indistinguível de rótulo que ninguém mapeou. Um é decisão, o outro é
 * buraco — e o segundo tem que parar o import.
 */
export const RESPOSTA_IGNORADA = 'ignorada';

export type LegacyResponseMatch =
  | { kind: 'response'; response: LootResponse }
  | { kind: typeof RESPOSTA_IGNORADA }
  | { kind: 'desconhecida'; chave: string };

/**
 * `(responseID, rótulo)` do RCLootCouncil → vocabulário canônico.
 *
 * **Os dois campos juntos, nunca um sozinho.** Medido nos 445 registros do export
 * real:
 *
 * - o rótulo varia de caixa e de idioma: `BiS`/`BIS`, `Bonus Loot`/`Bonus de
 *   botín`, porque vem do cliente de quem era loot master naquela noite;
 * - o `responseID` é **posicional**: o `2` aparece como `Big` (80 registros) e
 *   como `Banking` (2), que são coisas opostas.
 *
 * ## Por que constante, e não tabela no banco
 *
 * A issue original pedia "dado, não código", para acrescentar rótulo sem deploy
 * quando a próxima season trouxesse um novo. **Essa premissa caiu**: a guilda
 * parou de usar o RCLootCouncil, e esta importação existe só para alimentar o
 * histórico antigo. O conjunto de rótulos é fechado — é o que os arquivos
 * históricos contiverem.
 *
 * Sendo fechado, constante ganha: é tipada, então erro de escrita quebra no
 * build em vez de virar linha errada em produção; é revisável em PR com o
 * raciocínio no diff; e não existe estado no banco que discorde do código.
 *
 * Se aparecer outro arquivo histórico com rótulo novo, o import para e diz qual
 * é — e acrescentar é um PR de uma linha, uma vez.
 */
const LEGADO_RC: Readonly<Record<string, LootResponse | typeof RESPOSTA_IGNORADA>> = {
  '1|bis': LOOT_RESPONSES.BIS,
  '2|big': LOOT_RESPONSES.UPGRADE,
  '2|banking': LOOT_RESPONSES.BANKING,
  '3|minor': LOOT_RESPONSES.MINOR_UPGRADE,
  '3|minor upgrade': LOOT_RESPONSES.MINOR_UPGRADE,
  '4|offspec': LOOT_RESPONSES.OFFSPEC,
  '5|xmog': LOOT_RESPONSES.TRANSMOG,
  'pass|pass': LOOT_RESPONSES.PASS,

  /*
   * Bonus roll e personal loot não passaram pelo conselho — o item foi
   * distribuído automaticamente, e em 134 registros nenhum deles recebeu um único
   * voto. Não interessam a esta ferramenta, que existe para registrar decisão de
   * conselho.
   *
   * O rótulo em espanhol entra mesmo só tendo aparecido fora de raid: custa uma
   * linha e deixa o mapeamento independente da ordem em que o importador filtra.
   */
  'bonusroll|bonus loot': RESPOSTA_IGNORADA,
  'bonusroll|bonus de botín': RESPOSTA_IGNORADA,
  'pl|personal loot - non tradeable': RESPOSTA_IGNORADA,
};

/**
 * Chave do mapeamento: minúsculas e sem espaço nas pontas, nos dois campos.
 *
 * Só caixa e espaço, deliberadamente — **não** passa por `toSlug()`. Rótulo é
 * texto livre de outra ferramenta, não nome de personagem ou de realm, e colapsar
 * acento aqui juntaria rótulos que podem ser distintos. Quando um acento novo
 * aparecer, o import para e alguém decide — que é melhor que adivinhar.
 */
function chave(responseId: string, rotulo: string): string {
  return `${responseId.trim().toLowerCase()}|${rotulo.trim().toLowerCase()}`;
}

/**
 * Classifica uma resposta do export, ou avisa que não conhece.
 *
 * Devolve `desconhecida` em vez de lançar de propósito: assim o importador varre
 * o arquivo inteiro e reporta **todas** as combinações novas de uma vez, em vez de
 * obrigar uma execução por rótulo.
 */
export function matchLegacyResponse(responseId: string, rotulo: string): LegacyResponseMatch {
  const k = chave(responseId, rotulo);
  const achado = LEGADO_RC[k];

  if (achado === undefined) return { kind: 'desconhecida', chave: k };
  if (achado === RESPOSTA_IGNORADA) return { kind: RESPOSTA_IGNORADA };

  return { kind: 'response', response: achado };
}
