/** O mínimo de uma season para datar uma entrega. */
export interface SeasonInicio {
  id: number;
  startedAt: Date;
}

/**
 * A season em que a entrega aconteceu: a mais recente que já havia começado.
 *
 * **Pela data, não pelo tier da peça.** Uma entrega de setembro é da season
 * corrente mesmo que a peça tenha caído numa raid da season anterior — o tier é
 * característica do item, e a pergunta que o histórico responde é "o que o
 * conselho distribuiu nesta season".
 *
 * Devolve `null` quando a entrega é anterior a toda season conhecida, ou quando
 * nenhuma season foi carregada ainda. Lacuna, nunca a season mais próxima:
 * chutar aqui colocaria loot na season errada sem erro nenhum, e o sintoma
 * apareceria meses depois como número estranho num relatório.
 *
 * Espelha o backfill em SQL da migration `20260814010000`. As duas regras
 * precisam concordar — se uma mudar, a outra muda junto.
 */
export function seasonDaEntrega(awardedAt: Date, seasons: readonly SeasonInicio[]): number | null {
  let escolhida: SeasonInicio | null = null;

  for (const season of seasons) {
    if (season.startedAt > awardedAt) continue;
    if (escolhida === null || season.startedAt > escolhida.startedAt) escolhida = season;
  }

  return escolhida?.id ?? null;
}
