import type { GoldLedgerKind } from '@prisma/client';

/**
 * Rateio parimutuel de um mercado e saldo devido — domínio puro, aritmética
 * inteira (spec §8.1–§8.3, §16.6; D-06, D-10, R-20).
 */

export interface ApostaNoRateio {
  betId: string;
  /** Só apostas de slip `valido` chegam aqui (D-12). */
  stake: number;
  /** Aposta numa opção vencedora — com empate, em qualquer uma delas (§8.3). */
  vence: boolean;
}

export type Rateio =
  | {
      tipo: 'rateado';
      V: number;
      P: number;
      W: number;
      /** `G₀ = V − P`: os 10% da guilda, já com a fração (D-10). */
      receitaGuilda: number;
      /** `P − Σ payout`: a sobra do `floor`, também da guilda. */
      residuo: number;
      premios: Array<{ betId: string; amount: number }>;
    }
  /**
   * Há resultado, mas nenhuma aposta válida numa opção vencedora (`W = 0`). Um
   * mercado sozinho não decide o destino do `P`: ele é repartido entre os
   * outros mercados da rodada (D-44) — ver `liquidarRodada`.
   */
  | { tipo: 'sem_aposta_vencedora'; V: number };

/**
 * `payout(i) = floor(P × stake(i) / W)`, com `P = floor(9V/10)`. Não depende de
 * ordem: não existe "o primeiro fica com a sobra" (§8.2).
 */
export function ratearMercado(apostas: ApostaNoRateio[]): Rateio {
  const V = soma(apostas);
  const vencedoras = apostas.filter((a) => a.vence);
  const W = soma(vencedoras);
  if (W === 0) return { tipo: 'sem_aposta_vencedora', V };

  const P = Math.floor((9 * V) / 10);
  const premios = vencedoras.map((a) => ({
    betId: a.betId,
    amount: Math.floor((P * a.stake) / W),
  }));
  const pago = premios.reduce((total, p) => total + p.amount, 0);
  return { tipo: 'rateado', V, P, W, receitaGuilda: V - P, residuo: P - pago, premios };
}

/** Mercado `VOID` (D-06): cada aposta válida volta inteira; a guilda não recebe nada. */
export function restituirMercado(apostas: ApostaNoRateio[]): {
  V: number;
  receitaGuilda: 0;
  restituicoes: Array<{ betId: string; amount: number }>;
} {
  return {
    V: soma(apostas),
    receitaGuilda: 0,
    restituicoes: apostas.map((a) => ({ betId: a.betId, amount: a.stake })),
  };
}

/** O que credita a conta do membro; `pagamento` debita (§16.6). */
const CREDITOS: ReadonlySet<GoldLedgerKind> = new Set([
  'premio',
  'restituicao_anulado',
  'restituicao_expirado',
  'ajuste',
]);

/**
 * Saldo devido = Σ (`premio` + `restituicao_*` + `ajuste`) − Σ `pagamento`.
 * `deposito_validado` é o gold que entrou, não o que se deve; receita e resíduo
 * são da conta da guilda. Saldo negativo é a OQ-52 — aqui ele só é calculado.
 */
export function saldoDevido(lancamentos: Array<{ kind: GoldLedgerKind; amount: number }>): number {
  let saldo = 0;
  for (const l of lancamentos) {
    if (CREDITOS.has(l.kind)) saldo += l.amount;
    else if (l.kind === 'pagamento') saldo -= l.amount;
  }
  return saldo;
}

function soma(apostas: ApostaNoRateio[]): number {
  return apostas.reduce((total, a) => total + a.stake, 0);
}
