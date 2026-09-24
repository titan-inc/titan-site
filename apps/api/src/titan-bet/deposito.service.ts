import { Injectable } from '@nestjs/common';
import type { DepositosPendentes, SlipDoOfficer, SlipsSubmetidos } from '@titan/shared';
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

  /**
   * Os slips submetidos da rodada, em qualquer estado, sem as escolhas (T-C05):
   * a porta do "ver slip" (D-57). Rascunho não entra — não foi submetido.
   */
  async submetidos(roundId: string): Promise<SlipsSubmetidos> {
    const slips = await this.repo.slipsSubmetidos(roundId);
    return {
      slips: slips.map((s) => ({
        slipId: s.id,
        ownerBattletag: s.ownerBattletag,
        status: s.status as SlipsSubmetidos['slips'][number]['status'],
        // Submetido tem os três preenchidos — CHECK do banco por estado (§16.4).
        depositCharacter: s.depositCharacter!,
        expectedTotal: s.expectedTotal!,
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

  /**
   * "Ver slip" (D-57): o slip como foi submetido, só leitura, e o acesso
   * registrado em `BetEvent` na mesma transação. `null` se o slip não existe.
   */
  async verSlip(slipId: string, officer: Officer): Promise<SlipDoOfficer | null> {
    const r = await this.repo.verSlipComoOfficer({ slipId, officer });
    if (r.tipo === 'inexistente') return null;
    if (r.tipo === 'rascunho') throw new DepositoRecusado('o slip ainda não foi submetido');
    const s = r.slip;
    return {
      slipId: s.id,
      roundId: s.roundId,
      status: s.status as SlipDoOfficer['status'],
      ownerBattletag: s.ownerBattletag,
      eligibilityCharacter: s.eligibility.character,
      // Submetido tem os três preenchidos — CHECK do banco por estado (§16.4).
      depositCharacter: s.depositCharacter!,
      expectedTotal: s.expectedTotal!,
      submittedAt: s.submittedAt!.toISOString(),
      apostas: s.bets.map((b): SlipDoOfficer['apostas'][number] =>
        b.marketKind === 'weekly_progression'
          ? {
              marketId: b.marketId,
              marketKind: 'weekly_progression',
              stake: b.stake,
              boss: {
                roundEncounterId: b.targetEncounterId!,
                encounterName: b.targetEncounter!.encounterName,
              },
            }
          : {
              marketId: b.marketId,
              marketKind: b.marketKind,
              stake: b.stake,
              alvo: { characterId: b.targetCharacterId!, ...b.target!.character },
            },
      ),
      validatedByBattletag: s.validatedByBattletag,
      validatedAt: s.validatedAt?.toISOString() ?? null,
      rejectedByBattletag: s.rejectedByBattletag,
      rejectedAt: s.rejectedAt?.toISOString() ?? null,
      rejectionReason: s.rejectionReason,
      expiredAt: s.expiredAt?.toISOString() ?? null,
    };
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
