import { liquidarRodada, type MercadoParaLiquidar } from './liquidacao';

/**
 * Liquidação da rodada com redistribuição do `W = 0` (D-44; spec §8.6).
 * titan-bet-test-design.md §3.14, T-M10–T-M15.
 */

let n = 0;
const bet = (stake: number, vence: boolean) => ({ betId: `b${++n}`, stake, vence });

/** Mercado premiável: tem aposta vencedora. */
const premiavel = (marketId: string, vencedoras: number[], perdedoras: number[] = []) => ({
  marketId,
  desfecho: 'vencedores' as const,
  apostas: [...vencedoras.map((s) => bet(s, true)), ...perdedoras.map((s) => bet(s, false))],
});
/** Órfão: resultado válido, nenhuma aposta vencedora. */
const orfao = (marketId: string, perdedoras: number[]) => ({
  marketId,
  desfecho: 'vencedores' as const,
  apostas: perdedoras.map((s) => bet(s, false)),
});
const anulado = (marketId: string, apostas: number[]) => ({
  marketId,
  desfecho: 'anulado' as const,
  apostas: apostas.map((s) => bet(s, false)),
});

function liquidada(mercados: MercadoParaLiquidar[]) {
  const r = liquidarRodada(mercados);
  if (r.tipo !== 'liquidada') throw new Error(`esperado liquidada, veio ${r.tipo}`);
  return Object.fromEntries(r.mercados.map((m) => [m.marketId, m]));
}

describe('T-M10 — órfão não é VOID: sem restituição, G₀ da guilda', () => {
  it('V 1.000 sem aposta vencedora → receita 100, nenhuma restituição', () => {
    const r = liquidada([orfao('o', [600, 400]), premiavel('m', [1000])]);
    expect(r.o).toMatchObject({ tipo: 'orfao', V: 1000, P: 900, receitaGuilda: 100 });
    expect(r.o).not.toHaveProperty('restituicoes');
  });
});

describe('T-M11 — P do órfão dividido igualmente entre os premiáveis', () => {
  it('P 900 entre três → +300 cada, sem resto', () => {
    const r = liquidada([
      orfao('o', [1000]),
      premiavel('a', [500]),
      premiavel('b', [500]),
      premiavel('c', [500]),
    ]);
    expect(r.o).toMatchObject({ cota: 300, restoGuilda: 0, receptores: ['a', 'b', 'c'] });
    for (const id of ['a', 'b', 'c']) expect(r[id]).toMatchObject({ cotaRecebida: 300 });
  });

  it('resto indivisível fica com a guilda: P 1.000 entre três → +333, resto 1', () => {
    // V = 1.112 → P = floor(10.008 / 10) = 1.000.
    const r = liquidada([
      orfao('o', [1112]),
      premiavel('a', [500]),
      premiavel('b', [500]),
      premiavel('c', [500]),
    ]);
    expect(r.o).toMatchObject({ P: 1000, cota: 333, restoGuilda: 1 });
  });
});

describe('T-M12 — o receptor rateia P + cota', () => {
  it('P 900 + cota 300, W 600 → floor(1.200 × stake / 600)', () => {
    // Receptor: V 1.000 (vencedoras 400 + 200, perdedora 400) → P 900.
    const r = liquidada([orfao('o', [334]), premiavel('m', [400, 200], [400])]);
    // Órfão: V 334 → P 300, uma cota de 300 para o único premiável.
    expect(r.o).toMatchObject({ P: 300, cota: 300 });
    expect(r.m).toMatchObject({ tipo: 'rateado', P: 900, cotaRecebida: 300, W: 600 });
    if (r.m?.tipo !== 'rateado') throw new Error('esperado rateado');
    expect(r.m.premios.map((p) => p.amount)).toEqual([800, 400]);
    expect(r.m.residuo).toBe(0);
  });
});

describe('T-M13 — VOID e outro órfão não recebem; cada órfão reparte o seu', () => {
  it('dois órfãos, um VOID, dois premiáveis', () => {
    const r = liquidada([
      orfao('o1', [1000]), // P 900 → 450 + 450
      orfao('o2', [335]), // P 301 → 150 + 150, resto 1
      anulado('v', [700]),
      premiavel('a', [1000]),
      premiavel('b', [1000]),
    ]);
    expect(r.o1).toMatchObject({ cota: 450, restoGuilda: 0, receptores: ['a', 'b'] });
    expect(r.o2).toMatchObject({ cota: 150, restoGuilda: 1, receptores: ['a', 'b'] });
    expect(r.a).toMatchObject({ cotaRecebida: 600 });
    expect(r.b).toMatchObject({ cotaRecebida: 600 });
    expect(r.v).toMatchObject({ tipo: 'anulado', restituicoes: [{ amount: 700 }] });
  });

  it('sem órfão, nada muda: ninguém recebe cota', () => {
    const r = liquidada([premiavel('a', [500], [500])]);
    expect(r.a).toMatchObject({ cotaRecebida: 0, P: 900 });
  });
});

describe('T-M16 — mercado sem resultado premiável reparte o P (D-61)', () => {
  const semVencedor = (marketId: string, apostas: number[]) => ({
    marketId,
    desfecho: 'sem_vencedor' as const,
    apostas: apostas.map((st) => bet(st, false)),
  });

  it('G₀ para a guilda, P para os premiáveis, nenhuma restituição', () => {
    const r = liquidada([semVencedor('s', [1000]), premiavel('a', [500]), premiavel('b', [500])]);
    expect(r.s).toMatchObject({ tipo: 'orfao', V: 1000, P: 900, receitaGuilda: 100, cota: 450 });
    expect(r.s).not.toHaveProperty('restituicoes');
    expect(r.a).toMatchObject({ cotaRecebida: 450 });
  });

  it('sem vencedor não recebe cota de outro órfão', () => {
    const r = liquidada([semVencedor('s', [1000]), orfao('o', [1000]), premiavel('a', [500])]);
    expect(r.s).toMatchObject({ tipo: 'orfao' });
    expect(r.a).toMatchObject({ cotaRecebida: 1800 });
  });

  it('sem premiável para receber → não liquida, com o mercado identificado', () => {
    expect(liquidarRodada([semVencedor('s', [1000])])).toEqual({
      tipo: 'sem_mercado_premiavel',
      orfaos: ['s'],
    });
  });
});

describe('T-M14 — sem mercado premiável para o P do órfão → não liquida', () => {
  it('um órfão e um VOID: recusa, com o órfão identificado', () => {
    expect(liquidarRodada([orfao('o', [1000]), anulado('v', [500])])).toEqual({
      tipo: 'sem_mercado_premiavel',
      orfaos: ['o'],
    });
  });

  it('órfão com P = 0 (sem aposta) não tem o que repartir e não trava', () => {
    const r = liquidada([orfao('o', []), anulado('v', [500])]);
    expect(r.o).toMatchObject({ V: 0, P: 0, cota: 0, receptores: [] });
  });
});

describe('T-M15 — reconciliação da rodada fecha com redistribuição', () => {
  it('Σ prêmios + receitas + restos = Σ V dos mercados não anulados', () => {
    let semente = 7;
    const aleatorio = () => (semente = (semente * 48271) % 2147483647) / 2147483647;
    const stake = () => 200 + Math.floor(aleatorio() * 801);

    for (let caso = 0; caso < 300; caso++) {
      const mercados: MercadoParaLiquidar[] = [premiavel(`p${caso}`, [stake()], [stake()])];
      const extras = 1 + Math.floor(aleatorio() * 6);
      for (let i = 0; i < extras; i++) {
        const tipo = aleatorio();
        const id = `m${caso}-${i}`;
        if (tipo < 0.4) mercados.push(premiavel(id, [stake(), stake()], [stake()]));
        else if (tipo < 0.7) mercados.push(orfao(id, [stake(), stake()]));
        else mercados.push(anulado(id, [stake()]));
      }

      const r = liquidarRodada(mercados);
      if (r.tipo !== 'liquidada') throw new Error('esperado liquidada');
      let entrou = 0;
      let saiu = 0;
      for (const m of r.mercados) {
        if (m.tipo === 'anulado') continue;
        entrou += m.V;
        saiu += m.receitaGuilda;
        if (m.tipo === 'orfao') saiu += m.restoGuilda;
        else saiu += m.residuo + m.premios.reduce((s, p) => s + p.amount, 0);
      }
      expect(saiu).toBe(entrou);
    }
  });
});
