/**
 * A rodada foi cancelada por um officer (D-77): terminal, nenhuma mutação passa.
 *
 * Quem lança é o repositório, dentro da transação, depois de travar a linha da
 * rodada (`FOR SHARE`) — a mesma trava que o cancelamento toma para escrever.
 */
export class RodadaCancelada extends Error {
  constructor(roundId: string) {
    super(`a rodada ${roundId} foi cancelada — nada mais muda nela (D-77)`);
    this.name = 'RodadaCancelada';
  }
}
