import { BONUS_KINDS, type BonusDictionaryEntry, type DecodedBonuses } from '@titan/shared';

/**
 * `bonusIds` → estrutura legível — o coração da TIT-82.
 *
 * FUNÇÃO PURA: só olha o `dicionario` que recebe, nunca toca em banco. É o que
 * torna isto testável sem mock de Prisma — quem monta o dicionário a partir do
 * banco é `WowBonusService.decodificar`.
 *
 * Bonus ausente do `dicionario` vira `desconhecidos`, nunca é ignorado — Regra
 * 7. Um `itemString` pode ter mais de um bonus desconhecido misturado com
 * bonus conhecido, e os dois convivem na mesma saída.
 */
export function decodeBonuses(
  bonusIds: number[],
  dicionario: Map<number, BonusDictionaryEntry>,
): DecodedBonuses {
  const saida: DecodedBonuses = { track: null, sockets: 0, terciarios: [], desconhecidos: [] };

  for (const bonusId of bonusIds) {
    const entrada = dicionario.get(bonusId);

    if (!entrada) {
      saida.desconhecidos.push(bonusId);
      continue;
    }

    aplicar(saida, entrada);
  }

  return saida;
}

/**
 * Aplica uma entrada conhecida na saída, conforme o `kind`.
 *
 * Um `itemString` real não deveria trazer dois bonus de track — mas se trouxer,
 * o último vence em vez de estourar: é dado de jogo que o servidor manda,
 * nunca algo que o jogador controla, e a saída degradada é melhor que a sessão
 * quebrar no meio de uma raid.
 */
function aplicar(saida: DecodedBonuses, entrada: BonusDictionaryEntry): void {
  switch (entrada.kind) {
    case BONUS_KINDS.TRACK:
      saida.track = { nome: entrada.trackName, rank: entrada.trackRank, de: entrada.trackMaxRank };
      return;
    case BONUS_KINDS.TERTIARY:
      saida.terciarios.push(entrada.tertiary);
      return;
    case BONUS_KINDS.SOCKET:
      saida.sockets += 1;
      return;
  }
}
