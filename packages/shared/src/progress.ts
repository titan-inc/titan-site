import { z } from 'zod';

/**
 * Relatório de progressão: chaves feitas e evolução de item level.
 *
 * VALIDADE LIMITADA POR DESIGN. Ele vale nas primeiras semanas de uma season e
 * perde sentido conforme ela avança: no fim de season quem faz chave está
 * empurrando IO, não se gearando. O mesmo número significa coisas opostas
 * dependendo da semana — por isso a tela sempre mostra em que semana está.
 *
 * O dado real da season 17 mostra a curva: 198 chaves na semana 6, 56 na 11,
 * 19 na 16.
 */
export const progressRowSchema = z.object({
  name: z.string(),
  realm: z.string(),

  /** Item level na semana. Nulo = não medido; nunca zero. */
  itemLevel: z.number().nullable(),

  /** Variação em relação à semana anterior. Nulo se falta uma das pontas. */
  itemLevelDelta: z.number().nullable(),

  /** Distância para a média do time nesta semana. */
  itemLevelVsAverage: z.number().nullable(),

  /** Chaves fechadas na semana. */
  keysDone: z.number().nullable(),

  /** Distância para a média de chaves do time. */
  keysVsAverage: z.number().nullable(),

  /**
   * Total de M+ na season, do Raider.IO (`mythic_plus_dungeon_run_counts`).
   *
   * Número **completo**: o Raider.IO acumula desde o início da season. Somar
   * as semanas do WoWAudit daria um total menor, porque ele só tem histórico
   * a partir de quando passou a acompanhar o time.
   *
   * **Conta chave de qualquer nível, e isso é decisão, não descuido.** O
   * indicador existe para ver quem está se esforçando; quem ainda não aguenta
   * uma +7 continua tendo o esforço contado, que é justamente a pessoa sobre
   * quem o número precisa dizer alguma coisa. Filtrar por nível transformaria
   * "está jogando" em "está jogando bem" — outra pergunta, e uma que a Regra 7
   * manda pensar duas vezes antes de exibir em tabela comparativa.
   *
   * Isto vai voltar como suposto bug: a **página** do Raider.IO mostra uma
   * tabela de runs contando só de +7 para cima, então ela sempre dará um número
   * menor que o nosso. Conferido em 24/08/2026 num personagem real — nosso 66
   * no tempo batia com a API e com o addon no jogo; os 54 da página eram a soma
   * de +7 para cima, deixando 12 chaves de fora. Não é divergência para
   * corrigir; é a página respondendo outra pergunta.
   */
  keysInSeason: z.number().nullable(),

  /** Quantas do total foram no tempo. */
  keysInSeasonTimed: z.number().nullable(),

  /** Maior nível de chave na semana. Separa 3 chaves +10 de 3 chaves +2. */
  highestKey: z.number().nullable(),
});
export type ProgressRow = z.infer<typeof progressRowSchema>;

/** Season como aparece no seletor. O patch é o que a pessoa reconhece. */
export const seasonOptionSchema = z.object({
  id: z.number().int(),
  /** "12.0". Nulo se a fonte do rótulo falhou quando a season foi gravada. */
  patch: z.string().nullable(),
  name: z.string(),
});
export type SeasonOption = z.infer<typeof seasonOptionSchema>;

export const progressReportSchema = z.object({
  season: seasonOptionSchema,

  /** Últimas seasons gravadas, para o seletor. */
  availableSeasons: seasonOptionSchema.array(),

  /** Semana do jogo mostrada. */
  period: z.number().int(),

  /**
   * 1 na primeira semana **de M+** da season.
   *
   * Conta da abertura do M+, não do patch: a season de M+ abre uma semana
   * depois, e é o M+ que este relatório mede. Até 24/08/2026 contava do patch e
   * dizia "semana 2" na primeira semana de M+, em toda season (TIT-145).
   *
   * Numa season que abriu antes de o site existir não há observação da
   * abertura, e aí volta a contar do patch — errado do mesmo jeito de antes,
   * mas só onde não há como saber.
   */
  weekInSeason: z.number().int(),

  /** Quantas semanas de M+ a season tem até agora. Não conta a do patch. */
  periodCount: z.number().int(),

  /**
   * false = a season existe, mas o M+ dela ainda não abriu.
   *
   * A season de M+ **abre uma semana depois do patch**. Nesse intervalo a
   * Blizzard já publicou a season nova e o Raider.IO ainda responde a anterior,
   * então `keysInSeason` e o score saem nulos de propósito — o número que
   * existe é da season passada, e gravá-lo aqui seria atribuí-lo a esta.
   *
   * A tela precisa disto para dizer por que a coluna está vazia. Coluna vazia
   * sem explicação é lida como "o site quebrou".
   */
  mythicPlusOpen: z.boolean(),

  /**
   * Quando o job mediu esta semana pela última vez.
   *
   * A foto do period corrente é reescrita a cada rodada, então isto é a leitura
   * mais recente, não o instante em que a semana começou.
   *
   * **A tela precisa mostrar isto.** O roster lê o Raider.IO na hora do request
   * e esta tela lê o que o job gravou — as duas mostram "ilvl" e vão divergir
   * enquanto o job não roda de novo. Sem a data, quem abre as duas conclui que
   * uma está errada; com a data, a diferença se explica sozinha.
   */
  recordedAt: z.string().datetime(),

  /** Médias do time na semana. Nulas quando ninguém tem o dado. */
  average: z.object({
    itemLevel: z.number().nullable(),
    keysDone: z.number().nullable(),
  }),

  rows: progressRowSchema.array(),
});
export type ProgressReport = z.infer<typeof progressReportSchema>;

/**
 * Rótulo da season para humano: patch primeiro.
 *
 * "Season 17" não diz nada para jogador; "12.0" diz. Em WoW o **12** é a
 * expansão e o **.1** é season nova, com raid nova.
 */
export function seasonLabel(season: SeasonOption): string {
  return season.patch ? `${season.patch} — ${season.name}` : season.name;
}
