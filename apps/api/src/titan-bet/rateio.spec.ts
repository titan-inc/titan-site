import { ratearMercado, restituirMercado, saldoDevido, type ApostaNoRateio } from './rateio';

/**
 * Rateio parimutuel e saldo — domínio puro (spec §8.1–§8.3, §16.6; D-06, D-10,
 * R-20). titan-bet-test-design.md §3.5 e §3.6.
 */

const aposta = (betId: string, stake: number, vence: boolean): ApostaNoRateio => ({
  betId,
  stake,
  vence,
});

describe('ratearMercado', () => {
  it('T-M01: o exemplo da §8.2 — V 3.450, vencedoras 700 e 300', () => {
    const r = ratearMercado([
      aposta('a', 700, true),
      aposta('b', 300, true),
      aposta('c', 1000, false),
      aposta('d', 1000, false),
      aposta('e', 450, false),
    ]);
    expect(r).toEqual({
      tipo: 'rateado',
      V: 3450,
      P: 3105,
      W: 1000,
      receitaGuilda: 345,
      residuo: 1,
      premios: [
        { betId: 'a', amount: 2173 },
        { betId: 'b', amount: 931 },
      ],
    });
  });

  it('T-M03: empate — W soma as apostas de todas as opções vencedoras (§8.3)', () => {
    // Duas opções vencedoras: a (400) numa, b (600) na outra.
    const r = ratearMercado([
      aposta('a', 400, true),
      aposta('b', 600, true),
      aposta('c', 1000, false),
    ]);
    expect(r).toMatchObject({ tipo: 'rateado', W: 1000, P: 1800 });
    if (r.tipo !== 'rateado') throw new Error('esperado rateado');
    expect(r.premios).toEqual([
      { betId: 'a', amount: 720 },
      { betId: 'b', amount: 1080 },
    ]);
  });

  it('T-M05: tudo numa opção só → cada um recebe ~90% do que apostou', () => {
    const r = ratearMercado([aposta('a', 500, true), aposta('b', 500, true)]);
    if (r.tipo !== 'rateado') throw new Error('esperado rateado');
    expect(r.premios.map((p) => p.amount)).toEqual([450, 450]);
    expect(r.receitaGuilda).toBe(100);
  });

  it('T-M06: P = floor(9V/10) quando V não é múltiplo de 10 — a fração vai para a guilda', () => {
    const r = ratearMercado([aposta('a', 1001, true)]);
    expect(r).toMatchObject({ V: 1001, P: 900, receitaGuilda: 101, residuo: 0 });
  });

  it('T-M02: propriedades do arredondamento, em casos gerados deterministicamente (D-10)', () => {
    let semente = 42;
    const aleatorio = () => (semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

    for (let caso = 0; caso < 500; caso++) {
      const n = 1 + Math.floor(aleatorio() * 12);
      const apostas = Array.from({ length: n }, (_, i) =>
        aposta(`b${i}`, 200 + Math.floor(aleatorio() * 801), i === 0 || aleatorio() < 0.4),
      );
      const r = ratearMercado(apostas);
      if (r.tipo !== 'rateado') throw new Error('esperado rateado');

      const pago = r.premios.reduce((s, p) => s + p.amount, 0);
      const vencedoras = apostas.filter((a) => a.vence).length;
      expect(pago).toBeLessThanOrEqual(r.P);
      expect(pago + r.receitaGuilda + r.residuo).toBe(r.V);
      expect(r.residuo).toBeGreaterThanOrEqual(0);
      expect(r.residuo).toBeLessThan(vencedoras);

      // Não depende da ordem: invertido, cada aposta recebe o mesmo.
      const invertido = ratearMercado([...apostas].reverse());
      if (invertido.tipo !== 'rateado') throw new Error('esperado rateado');
      const porAposta = (x: typeof r) =>
        Object.fromEntries(x.premios.map((p) => [p.betId, p.amount]));
      expect(porAposta(invertido)).toEqual(porAposta(r));
    }
  });

  it('opção vencedora sem nenhuma aposta (W = 0): não inventa rateio — a spec não define', () => {
    const r = ratearMercado([aposta('a', 500, false), aposta('b', 300, false)]);
    expect(r).toEqual({ tipo: 'sem_aposta_vencedora', V: 800 });
  });

  it('mercado sem aposta nenhuma: nada a ratear', () => {
    expect(ratearMercado([])).toEqual({ tipo: 'sem_aposta_vencedora', V: 0 });
  });
});

describe('restituirMercado — T-M04: VOID devolve o stake inteiro, sem receita (D-06)', () => {
  it('uma restituição por aposta, do valor integral; guilda 0', () => {
    expect(restituirMercado([aposta('a', 700, false), aposta('b', 300, false)])).toEqual({
      V: 1000,
      receitaGuilda: 0,
      restituicoes: [
        { betId: 'a', amount: 700 },
        { betId: 'b', amount: 300 },
      ],
    });
  });
});

describe('saldoDevido — T-L04: créditos − pagamentos (§16.6)', () => {
  it('prêmio, restituições e ajuste creditam; pagamento debita; depósito não conta', () => {
    expect(
      saldoDevido([
        { kind: 'deposito_validado', amount: 1000 },
        { kind: 'premio', amount: 2173 },
        { kind: 'restituicao_anulado', amount: 300 },
        { kind: 'restituicao_expirado', amount: 200 },
        { kind: 'ajuste', amount: -100 },
        { kind: 'pagamento', amount: 2000 },
      ]),
    ).toBe(573);
  });

  it('sem lançamento, saldo zero; pago por inteiro, saldo zero', () => {
    expect(saldoDevido([])).toBe(0);
    expect(
      saldoDevido([
        { kind: 'premio', amount: 931 },
        { kind: 'pagamento', amount: 931 },
      ]),
    ).toBe(0);
  });

  it('conta da guilda não é saldo de membro: receita e resíduo não entram', () => {
    expect(
      saldoDevido([
        { kind: 'receita_guilda', amount: 345 },
        { kind: 'residuo_guilda', amount: 1 },
      ]),
    ).toBe(0);
  });
});
