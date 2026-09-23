import { Injectable } from '@nestjs/common';
import type { DepositosPendentes } from '@titan/shared';
import { TitanBetRepository } from './titan-bet.repository';

/** A ação do officer sobre o depósito foi recusada; nada mudou. */
export class DepositoRecusado extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'DepositoRecusado';
  }
}

interface Officer {
  userId: string;
  battletag: string;
}

/**
 * Depósito no Guild Bank, conferido à mão pelo officer (R-12, R-13).
 *
 * Confirmar: `aguardando_deposito` → `valido`, com o lançamento
 * `deposito_validado` na mesma transação (R-15, §16.6). Recusar:
 * `aguardando_deposito` → `recusado`, terminal, com motivo (D-34). Os dois só
 * antes do cutoff — quem garante é o banco.
 */
@Injectable()
export class DepositoService {
  constructor(private readonly repo: TitanBetRepository) {}

  /** O que o officer confere no Guild Bank: dono, depositante e total (§16.9). */
  async pendentes(roundId: string): Promise<DepositosPendentes> {
    const slips = await this.repo.depositosPendentes(roundId);
    return {
      depositos: slips.map((s) => ({
        slipId: s.id,
        ownerBattletag: s.ownerBattletag,
        // Pendente tem os três preenchidos — um CHECK do banco garante (§16.4).
        depositCharacter: s.depositCharacter!,
        expectedTotal: s.expectedTotal!,
        status: 'aguardando_deposito' as const,
        submittedAt: s.submittedAt!.toISOString(),
      })),
    };
  }

  async confirmar(slipId: string, officer: Officer): Promise<void> {
    const r = await this.comoRecusa(() =>
      this.repo.confirmarDeposito({ slipId, officer, agora: new Date() }),
    );
    if (r.tipo === 'nao_pendente') throw new DepositoRecusado(naoPendente(r.status));
  }

  async recusar(slipId: string, officer: Officer, motivo: string): Promise<void> {
    const r = await this.comoRecusa(() =>
      this.repo.recusarDeposito({ slipId, officer, motivo, agora: new Date() }),
    );
    if (r.tipo === 'nao_pendente') throw new DepositoRecusado(naoPendente(r.status));
  }

  private async comoRecusa<T>(operacao: () => Promise<T>): Promise<T> {
    try {
      return await operacao();
    } catch (erro: unknown) {
      if (erro instanceof DepositoRecusado) throw erro;
      throw new DepositoRecusado(erro instanceof Error ? erro.message : String(erro));
    }
  }
}

function naoPendente(status: string | null): string {
  return status === null
    ? 'o slip não existe'
    : `o slip está ${status} — só se confirma ou recusa depósito pendente`;
}
