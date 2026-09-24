import { Injectable } from '@nestjs/common';
import type { LancamentosDoSlip, SaldosDaRodada } from '@titan/shared';
import { liquidarRodada, type MercadoParaLiquidar } from './liquidacao';
import { saldoDevido } from './rateio';
import {
  TitanBetRepository,
  type DadosDaConfirmacao,
  type LancamentoDoSettlement,
} from './titan-bet.repository';

/** A operação no ledger foi recusada; nada foi lançado. */
export class LedgerRecusado extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'LedgerRecusado';
  }
}

interface Officer {
  userId: string;
  battletag: string;
}

/**
 * Confirmar a auditoria é o settlement (D-16, §16.6): o officer aceita os
 * resultados calculados — inclusive as propostas de VOID — e, na mesma
 * transação, entram os prêmios, as restituições e a parte da guilda. É a única
 * porta para dinheiro sair da conta de uma aposta.
 *
 * O rateio é o da rodada inteira (`liquidarRodada`), com a redistribuição do
 * mercado sem aposta vencedora (D-44). Sem mercado premiável para receber, a
 * D-44 manda parar e consultar: nada é confirmado.
 */
@Injectable()
export class SettlementService {
  constructor(private readonly repo: TitanBetRepository) {}

  async confirmar(auditId: string, officer: Officer): Promise<void> {
    let r: Awaited<ReturnType<TitanBetRepository['confirmarAuditoria']>>;
    try {
      r = await this.repo.confirmarAuditoria({
        auditId,
        officer,
        agora: new Date(),
        liquidar: planejarSettlement,
      });
    } catch (erro: unknown) {
      // Duas confirmações ao mesmo tempo: o índice "uma confirmada por rodada"
      // e a trava da auditoria deixam passar uma.
      const motivo = erro instanceof Error ? erro.message : String(erro);
      throw new LedgerRecusado(`a confirmação não foi gravada: ${motivo}`);
    }
    if (r.tipo === 'recusado') throw new LedgerRecusado(r.motivo);
  }
}

/** Os lançamentos do settlement, ou a recusa — puro, sobre o que a transação leu. */
export function planejarSettlement(
  d: DadosDaConfirmacao,
): { lancamentos: LancamentoDoSettlement[] } | { recusa: string } {
  const aposta = new Map(d.apostas.map((a) => [a.id, a]));
  const resultado = new Map(d.resultados.map((r) => [r.marketId, r]));

  const mercados: MercadoParaLiquidar[] = [];
  for (const r of d.resultados) {
    const doMercado = d.apostas.filter((a) => a.marketId === r.marketId);
    const V = doMercado.reduce((s, a) => s + a.stake, 0);
    if (V !== r.validPool) {
      // Depois do cutoff nenhum slip vira válido (trigger); se V mudou, o
      // cálculo não descreve mais as apostas e não se paga sobre ele.
      return {
        recusa: `as apostas válidas do mercado ${r.marketId} somam ${V}, o cálculo leu ${r.validPool}`,
      };
    }
    const vencedores = new Set(r.winners.map((w) => w.characterId));
    const k = r.kills.map((x) => x.roundEncounterId);
    mercados.push({
      marketId: r.marketId,
      desfecho: r.outcome,
      apostas: doMercado.map((a) => ({
        betId: a.id,
        stake: a.stake,
        // Weekly (D-54): vence a aposta no boss de progressão que morreu.
        vence:
          r.market.kind === 'weekly_progression'
            ? a.targetEncounterId !== null && k.includes(a.targetEncounterId)
            : a.targetCharacterId !== null && vencedores.has(a.targetCharacterId),
      })),
    });
  }

  const liquidacao = liquidarRodada(mercados);
  if (liquidacao.tipo === 'sem_mercado_premiavel') {
    return {
      recusa:
        `nenhum mercado premiável para receber o prize pool de ${liquidacao.orfaos.join(', ')} — ` +
        'a D-44 não tem regra para isso; consultar a liderança antes de confirmar',
    };
  }

  const lancamentos: LancamentoDoSettlement[] = [];
  const doMembro = (
    kind: 'premio' | 'restituicao_anulado',
    betId: string,
    marketId: string,
    amount: number,
  ) => {
    if (amount <= 0) return;
    lancamentos.push({
      account: 'membro',
      kind,
      amount,
      slipId: aposta.get(betId)!.slipId,
      betId,
      marketId,
      resultId: resultado.get(marketId)!.id,
    });
  };
  const daGuilda = (
    kind: 'receita_guilda' | 'residuo_guilda',
    marketId: string,
    amount: number,
  ) => {
    // Linha de valor zero não existe no ledger (CHECK `amount > 0`).
    if (amount <= 0) return;
    lancamentos.push({
      account: 'guild_bank',
      kind,
      amount,
      slipId: null,
      betId: null,
      marketId,
      resultId: resultado.get(marketId)!.id,
    });
  };

  for (const m of liquidacao.mercados) {
    switch (m.tipo) {
      case 'rateado':
        m.premios.forEach((p) => doMembro('premio', p.betId, m.marketId, p.amount));
        daGuilda('receita_guilda', m.marketId, m.receitaGuilda);
        daGuilda('residuo_guilda', m.marketId, m.residuo);
        break;
      case 'orfao':
        daGuilda('receita_guilda', m.marketId, m.receitaGuilda);
        daGuilda('residuo_guilda', m.marketId, m.restoGuilda);
        break;
      case 'anulado':
        m.restituicoes.forEach((x) =>
          doMembro('restituicao_anulado', x.betId, m.marketId, x.amount),
        );
        break;
    }
  }
  return { lancamentos };
}

/**
 * A conta do membro na rodada — o slip (§16.6): saldo, pagamento e ajuste.
 *
 * Pagar lança o saldo inteiro, com o slip travado: dois pagamentos ao mesmo
 * tempo não pagam duas vezes (T-L05). Pagamento nunca é reescrito; correção é
 * `ajuste` com motivo e referência, e o saldo novo gera outro `pagamento` (D-11).
 */
@Injectable()
export class LedgerService {
  constructor(private readonly repo: TitanBetRepository) {}

  /** O total por membro na rodada: devido agora e já pago (§8.5). */
  async saldos(roundId: string): Promise<SaldosDaRodada> {
    const contas = await this.repo.contasDosMembros(roundId);
    return {
      saldos: contas.map((c) => ({
        slipId: c.id,
        ownerBattletag: c.ownerBattletag,
        devido: saldoDevido(c.ledger),
        pago: c.ledger.filter((l) => l.kind === 'pagamento').reduce((s, l) => s + l.amount, 0),
      })),
    };
  }

  /**
   * Os lançamentos de um slip, em ordem (T-C06): é daqui que o officer tira o
   * lançamento que um ajuste corrige (D-11). Nenhuma aposta ou mercado.
   */
  async lancamentos(slipId: string): Promise<LancamentosDoSlip> {
    const lista = await this.repo.lancamentosDoSlip(slipId);
    return {
      lancamentos: lista.map((l) => ({
        entryId: l.id.toString(),
        kind: l.kind,
        amount: l.amount,
        reason: l.reason,
        actorBattletag: l.actorBattletag,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  }

  async saldo(slipId: string): Promise<number> {
    return saldoDevido(await this.repo.lancamentosDoSlip(slipId));
  }

  async pagar(slipId: string, officer: Officer): Promise<void> {
    const r = await this.repo.lancarNaContaDoMembro({
      slipId,
      officer,
      decidir: (lancamentos) => {
        const saldo = saldoDevido(lancamentos);
        if (saldo <= 0) return { recusa: 'não há saldo devido a pagar' };
        return {
          kind: 'pagamento',
          amount: saldo,
          coversThroughEntryId: lancamentos[lancamentos.length - 1]!.id,
        };
      },
    });
    if (r.tipo === 'recusado') throw new LedgerRecusado(r.motivo);
  }

  async ajustar(
    a: { slipId: string; amount: number; reason: string; correctsEntryId: bigint },
    officer: Officer,
  ): Promise<void> {
    const motivo = a.reason.trim();
    if (!motivo) throw new LedgerRecusado('ajuste exige motivo (D-11)');
    if (!Number.isInteger(a.amount) || a.amount === 0) {
      throw new LedgerRecusado('ajuste é um valor inteiro de gold, diferente de zero');
    }
    const r = await this.repo.lancarNaContaDoMembro({
      slipId: a.slipId,
      officer,
      decidir: (lancamentos) => {
        if (!lancamentos.some((l) => l.id === a.correctsEntryId)) {
          return { recusa: 'o lançamento corrigido não é da conta deste slip' };
        }
        if (saldoDevido(lancamentos) + a.amount < 0) {
          return { recusa: 'o ajuste deixaria o saldo negativo — é a OQ-52, em aberto' };
        }
        return {
          kind: 'ajuste',
          amount: a.amount,
          reason: motivo,
          correctsEntryId: a.correctsEntryId,
        };
      },
    });
    if (r.tipo === 'recusado') throw new LedgerRecusado(r.motivo);
  }
}
