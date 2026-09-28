import type { OddsDaRodada, RodadaDoMembro } from '@titan/shared';
import { tituloDoMercado } from './rotulos';

export interface OpcaoComValor {
  id: string;
  nome: string;
  /** Nulo para boss da Weekly, que não tem realm. */
  realm: string | null;
  multiplicador: number;
}

export interface MercadoComValor {
  marketId: string;
  titulo: string;
  opcoes: OpcaoComValor[];
}

/**
 * As odds que têm valor (D-80): só as opções com aposta válida, por mercado, da que
 * mais paga para a que menos paga.
 *
 * "Tem valor" é `multiplicador !== null` — o mesmo "—" da tela da rodada. Empate de
 * multiplicador desempata por nome e realm, para a ordem não depender de quem chegou
 * primeiro. Opção que o cardápio não conhece é descartada: dado inconsistente não vira
 * linha na tela.
 */
export function oddsComValor(cardapio: RodadaDoMembro, odds: OddsDaRodada): MercadoComValor[] {
  const candidatos = new Map(cardapio.candidatos.map((c) => [c.characterId, c]));
  const bosses = new Map(
    cardapio.bossesDeProgressao.map((b) => [b.roundEncounterId, b.encounterName]),
  );

  return cardapio.mercados.flatMap((m): MercadoComValor[] => {
    const doMercado = odds.mercados.find((x) => x.marketId === m.marketId);
    if (!doMercado) return [];

    const opcoes = doMercado.opcoes
      .flatMap((o): OpcaoComValor[] => {
        if (o.multiplicador === null) return [];
        if ('roundEncounterId' in o) {
          const nome = bosses.get(o.roundEncounterId);
          return nome
            ? [{ id: o.roundEncounterId, nome, realm: null, multiplicador: o.multiplicador }]
            : [];
        }
        const c = candidatos.get(o.characterId);
        return c
          ? [{ id: c.characterId, nome: c.name, realm: c.realm, multiplicador: o.multiplicador }]
          : [];
      })
      .sort(
        (a, b) =>
          b.multiplicador - a.multiplicador ||
          a.nome.localeCompare(b.nome) ||
          (a.realm ?? '').localeCompare(b.realm ?? ''),
      );

    if (opcoes.length === 0) return [];
    return [
      {
        marketId: m.marketId,
        titulo: tituloDoMercado(m.kind, m.boss?.encounterName ?? null),
        opcoes,
      },
    ];
  });
}
