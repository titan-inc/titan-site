import { restituirMercado, type ApostaNoRateio } from './rateio';

/**
 * Liquidação da rodada inteira, com a redistribuição do mercado sem aposta
 * vencedora (D-44; spec §8.6). Domínio puro, aritmética inteira.
 *
 * Um mercado com resultado válido e `W = 0` é **órfão**: não é VOID, ninguém é
 * restituído, o `G₀` dele fica com o Guild Bank e o `P` é repartido igualmente
 * entre os mercados **premiáveis** da rodada (resultado `vencedores` e
 * `W > 0`). Cada órfão reparte o próprio `P`, e o resto de cada divisão é do
 * Guild Bank (D-10).
 */

export interface MercadoParaLiquidar {
  marketId: string;
  /** O desfecho confirmado: vencedores (mesmo que ninguém tenha apostado neles) ou VOID. */
  desfecho: 'vencedores' | 'anulado';
  /** Apostas válidas do mercado (D-12), marcadas se estão numa opção vencedora. */
  apostas: ApostaNoRateio[];
}

export type MercadoLiquidado =
  | {
      marketId: string;
      tipo: 'rateado';
      V: number;
      /** `floor(9V/10)` do próprio mercado, antes das cotas recebidas. */
      P: number;
      /** O que veio dos órfãos da rodada. */
      cotaRecebida: number;
      W: number;
      receitaGuilda: number;
      /** `P + cotaRecebida − Σ prêmios`: a sobra do `floor`, da guilda. */
      residuo: number;
      premios: Array<{ betId: string; amount: number }>;
    }
  | {
      marketId: string;
      tipo: 'orfao';
      V: number;
      P: number;
      receitaGuilda: number;
      /** Quanto cada receptor recebeu deste órfão. */
      cota: number;
      /** `P − cota × receptores`: o indivisível, da guilda. */
      restoGuilda: number;
      receptores: string[];
    }
  | {
      marketId: string;
      tipo: 'anulado';
      V: number;
      receitaGuilda: 0;
      restituicoes: Array<{ betId: string; amount: number }>;
    };

export type Liquidacao =
  | { tipo: 'liquidada'; mercados: MercadoLiquidado[] }
  /**
   * Um órfão com `P > 0` e nenhum mercado premiável para receber: a D-44 não
   * tem regra para isso, e aqui não se inventa uma. Nada é liquidado.
   */
  | { tipo: 'sem_mercado_premiavel'; orfaos: string[] };

export function liquidarRodada(mercados: MercadoParaLiquidar[]): Liquidacao {
  const premiaveis = mercados.filter((m) => m.desfecho === 'vencedores' && W(m) > 0);
  const orfaos = mercados.filter((m) => m.desfecho === 'vencedores' && W(m) === 0);
  const receptores = premiaveis.map((m) => m.marketId);

  const travados = orfaos.filter((m) => P(m) > 0 && receptores.length === 0);
  if (travados.length > 0) {
    return { tipo: 'sem_mercado_premiavel', orfaos: travados.map((m) => m.marketId) };
  }

  const cotaPorReceptor = new Map<string, number>(receptores.map((id) => [id, 0]));
  const liquidados = new Map<string, MercadoLiquidado>();

  for (const o of orfaos) {
    const p = P(o);
    const recebem = p > 0 ? receptores : [];
    const cota = recebem.length > 0 ? Math.floor(p / recebem.length) : 0;
    for (const id of recebem) cotaPorReceptor.set(id, cotaPorReceptor.get(id)! + cota);
    liquidados.set(o.marketId, {
      marketId: o.marketId,
      tipo: 'orfao',
      V: V(o),
      P: p,
      receitaGuilda: V(o) - p,
      cota,
      restoGuilda: p - cota * recebem.length,
      receptores: recebem,
    });
  }

  for (const m of premiaveis) {
    const cotaRecebida = cotaPorReceptor.get(m.marketId)!;
    const pool = P(m) + cotaRecebida;
    const w = W(m);
    const premios = m.apostas
      .filter((a) => a.vence)
      .map((a) => ({ betId: a.betId, amount: Math.floor((pool * a.stake) / w) }));
    const pago = premios.reduce((total, p) => total + p.amount, 0);
    liquidados.set(m.marketId, {
      marketId: m.marketId,
      tipo: 'rateado',
      V: V(m),
      P: P(m),
      cotaRecebida,
      W: w,
      receitaGuilda: V(m) - P(m),
      residuo: pool - pago,
      premios,
    });
  }

  for (const m of mercados.filter((x) => x.desfecho === 'anulado')) {
    liquidados.set(m.marketId, {
      marketId: m.marketId,
      tipo: 'anulado',
      ...restituirMercado(m.apostas),
    });
  }

  return { tipo: 'liquidada', mercados: mercados.map((m) => liquidados.get(m.marketId)!) };
}

function V(m: MercadoParaLiquidar): number {
  return m.apostas.reduce((total, a) => total + a.stake, 0);
}

function W(m: MercadoParaLiquidar): number {
  return m.apostas.filter((a) => a.vence).reduce((total, a) => total + a.stake, 0);
}

function P(m: MercadoParaLiquidar): number {
  return Math.floor((9 * V(m)) / 10);
}
