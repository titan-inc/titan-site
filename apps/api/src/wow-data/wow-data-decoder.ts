import {
  escolherItemLevel,
  statsAdicionadosDe,
  terciariosDe,
  type BonusFacets,
  type DecodedBonuses,
} from '@titan/shared';

/**
 * `bonusIds` → estrutura legível — o coração da TIT-82, remodelado pela
 * TIT-137.
 *
 * FUNÇÃO PURA: só olha o `dicionario` que recebe, nunca toca em banco. É o que
 * torna isto testável sem mock de Prisma — quem monta o dicionário é
 * `WowDataService.decodificar`.
 *
 * Bonus ausente do `dicionario` vira `desconhecidos`, nunca é ignorado — Regra
 * 7. Um `itemString` pode ter bonus desconhecido misturado com conhecido, e os
 * dois convivem na mesma saída.
 */
export function decodeBonuses(
  bonusIds: number[],
  dicionario: Map<number, BonusFacets>,
): DecodedBonuses {
  const saida: DecodedBonuses = {
    itemLevel: null,
    track: null,
    sockets: 0,
    terciarios: [],
    statsAdicionados: [],
    binding: null,
    dificuldade: null,
    desconhecidos: [],
  };

  const comItemLevel: BonusFacets[] = [];

  for (const bonusId of bonusIds) {
    const facetas = dicionario.get(bonusId);

    if (!facetas) {
      saida.desconhecidos.push(bonusId);
      continue;
    }

    if (facetas.itemLevel !== null) comItemLevel.push(facetas);
    aplicar(saida, facetas);
  }

  // DEPOIS do laço, e não "o último vence": duas listas do mesmo itemString
  // podem disputar o ilvl, e quem desempata é o marcador — ver
  // `escolherItemLevel`. Resolver dentro do laço deixaria a ordem de iteração
  // decidir, que não é regra, é sorte.
  saida.itemLevel = escolherItemLevel(comItemLevel);
  saida.terciarios = terciariosDe(saida.statsAdicionados);

  return saida;
}

/**
 * Aplica as facetas de um bonus conhecido.
 *
 * **Não existe mais `switch` por `kind`, e a mudança não é estética:** medido
 * no build 12.1.0, 19% dos bonus ids carregam mais de um significado ao mesmo
 * tempo — o `12825` é track E qualidade E scale config. Cada faceta é testada
 * por conta própria, e um bonus pode acionar várias.
 *
 * Facetas escalares (track, ilvl, vínculo, dificuldade) seguem "o último
 * vence" em vez de estourar: é dado de jogo que o servidor manda, nunca algo
 * que o jogador controla, e saída degradada é melhor que a sessão quebrar no
 * meio de uma raid.
 */
function aplicar(saida: DecodedBonuses, facetas: BonusFacets): void {
  if (facetas.trackName !== null && facetas.trackRank !== null && facetas.trackMaxRank !== null) {
    saida.track = {
      nome: facetas.trackName,
      rank: facetas.trackRank,
      de: facetas.trackMaxRank,
      // Cru de propósito: quem decide se a contagem `4/6` aparece é o
      // renderizador, comparando com a season corrente. Peça de season passada
      // mostra só `Myth`.
      scalingId: facetas.trackScalingId,
    };
  }

  // O ilvl NÃO é decidido aqui — ver o comentário em `decodeBonuses`.

  // Os stats do `Type 2` SOMAM entre bônus: dois bônus podem acrescentar o
  // mesmo stat, e o renderizador é quem agrega. Aqui só se acumula a lista.
  saida.statsAdicionados.push(...statsAdicionadosDe(facetas));

  if (facetas.hasSocket) {
    saida.sockets += 1;
  }

  if (facetas.binding !== null) {
    saida.binding = facetas.binding;
  }

  if (facetas.difficulty !== null) {
    saida.dificuldade = facetas.difficulty;
  }
}
