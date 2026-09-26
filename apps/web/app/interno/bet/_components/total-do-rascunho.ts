import { STAKE_MAXIMO, STAKE_MINIMO, type RodadaDoMembro } from '@titan/shared';

/** A escolha de um mercado, como o form guarda: o stake ainda é o texto digitado. */
interface EscolhaDaTela {
  opcao: string | null;
  stake: string;
}

export interface ResumoDoRascunho {
  /** Só o que o Salvar aceitaria: mercado com opção e stake válido. */
  total: number;
  mercadosEscolhidos: number;
  mercadosTotal: number;
  /** Escolhas com stake fora do contrato — ficam fora do `total`, e a tela avisa. */
  stakesInvalidos: number;
}

/**
 * O total do rascunho que está na tela (D-79), sem chamar a API.
 *
 * Os limites vêm do shared (Regra 2). Stake inválido não é somado em silêncio: a
 * soma mostrada tem que ser a que o Salvar aceitaria, e o que ficou de fora vira
 * `stakesInvalidos`.
 */
export function totalDoRascunho(
  cardapio: RodadaDoMembro,
  escolhas: Partial<Record<string, EscolhaDaTela>>,
): ResumoDoRascunho {
  let total = 0;
  let mercadosEscolhidos = 0;
  let stakesInvalidos = 0;

  for (const m of cardapio.mercados) {
    const e = escolhas[m.marketId];
    if (!e?.opcao) continue;
    mercadosEscolhidos += 1;

    const stake = e.stake.trim() === '' ? NaN : Number(e.stake);
    if (Number.isInteger(stake) && stake >= STAKE_MINIMO && stake <= STAKE_MAXIMO) total += stake;
    else stakesInvalidos += 1;
  }

  return { total, mercadosEscolhidos, mercadosTotal: cardapio.mercados.length, stakesInvalidos };
}
