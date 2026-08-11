import { z } from 'zod';

/**
 * Os slugs das opções que o sistema **semeia**.
 *
 * ATENÇÃO: isto **não** é o conjunto de valores possíveis. As opções de resposta
 * são uma tabela (`LootResponseOption`), configurável no app — a liderança
 * acrescenta e desativa sem deploy. Um enum Zod fechado aqui reprovaria a opção
 * nova que alguém cadastrasse.
 *
 * Existe para duas coisas terem referência tipada aos defaults: o tradutor do
 * histórico abaixo, e o seed da migration. Para validar a resposta de uma linha
 * de loot, confira contra a tabela, nunca contra esta lista.
 *
 * **Slug é identidade estável e imutável.** Renomear é reescrever passado; o que
 * se edita é o `label` da tabela. É justamente o erro que o `responseID` do
 * RCLootCouncil comete — lá o `2` é `Big` num raid e `Banking` noutro, porque é o
 * índice do botão — e é a mesma armadilha do `guildRank` na Regra 4.
 */
export const LOOT_RESPONSES = {
  /** Melhor peça possível para a spec. */
  BIS: 'bis',
  /** Upgrade relevante, sem ser o ideal. */
  UPGRADE: 'upgrade',
  /** Upgrade pequeno. */
  MINOR: 'minor',
  /** Serve para a spec secundária. */
  OFFSPEC: 'offspec',
  /** Só pela aparência. */
  TRANSMOG: 'transmog',
  /**
   * Declarou não querer.
   *
   * Acumula três situações que o RCLootCouncil separava — ausência de resposta,
   * pass ativo no botão, e "not eligible". No nosso desenho o jogador **sempre**
   * responde a todo loot, então `pass` é escolha, não lacuna.
   *
   * E aparece como vencedor: num drop que ninguém quis, quem votou `pass` levou
   * por ter tirado o maior roll. Registro real de 28/04/2026 — não é dado sujo, e
   * não é sanitizado na importação.
   */
  PASS: 'pass',
  /**
   * Foi para o banco da guilda, não para uma pessoa.
   *
   * Única opção de **loot master** entre as semeadas: é decisão sobre o destino
   * do item, não declaração de interesse. O próprio RCLootCouncil a marca com
   * `isAwardReason=true`, e era o único rótulo assim nos 445 registros.
   */
  BANKING: 'banking',
} as const;

/**
 * Slug de opção de resposta.
 *
 * String, e **não** enum fechado: a lista de opções é configurável na tabela, e
 * um `nativeEnum` aqui recusaria a opção que a liderança cadastrar. Quem valida
 * de verdade é a existência da linha em `LootResponseOption`.
 */
export const lootResponseSlugSchema = z.string().min(1);
export type LootResponseSlug = z.infer<typeof lootResponseSlugSchema>;

/** Um dos slugs semeados. Só para o tradutor e o seed — ver `LOOT_RESPONSES`. */
export type SeededLootResponse = (typeof LOOT_RESPONSES)[keyof typeof LOOT_RESPONSES];

/**
 * Combinação que o import reconhece e **descarta de propósito**.
 *
 * Existe como valor explícito, e não como ausência, porque descarte silencioso
 * seria indistinguível de rótulo que ninguém mapeou. Um é decisão, o outro é
 * buraco — e o segundo tem que parar o import.
 */
export const RESPOSTA_IGNORADA = 'ignorada';

export type LegacyResponseMatch =
  | { kind: 'response'; response: SeededLootResponse }
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
const LEGADO_RC: Readonly<Record<string, SeededLootResponse | typeof RESPOSTA_IGNORADA>> = {
  '1|bis': LOOT_RESPONSES.BIS,
  '2|big': LOOT_RESPONSES.UPGRADE,
  '2|banking': LOOT_RESPONSES.BANKING,
  '3|minor': LOOT_RESPONSES.MINOR,
  '3|minor upgrade': LOOT_RESPONSES.MINOR,
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
