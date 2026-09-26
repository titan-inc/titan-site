import { describe, expect, it } from 'vitest';
import { CARDAPIO } from './fixtures';
import { totalDoRascunho } from './total-do-rascunho';

/** D-79 — o total do rascunho que a tela mostra, sem chamar a API. */

describe('totalDoRascunho', () => {
  it('T-F01: sem escolha, total 0 e nenhum mercado', () => {
    expect(totalDoRascunho(CARDAPIO, {})).toEqual({
      total: 0,
      mercadosEscolhidos: 0,
      mercadosTotal: 3,
      stakesInvalidos: 0,
    });
  });

  it('T-F02: soma só mercados com opção; stake de mercado sem opção é ignorado', () => {
    const r = totalDoRascunho(CARDAPIO, {
      'm-dps': { opcao: 'c-outro', stake: '300' },
      'm-fd': { opcao: null, stake: '900' },
      'm-weekly': { opcao: 'e2', stake: '250' },
    });
    expect(r).toMatchObject({ total: 550, mercadosEscolhidos: 2, stakesInvalidos: 0 });
  });

  it.each(['199', '1001', '', '250.5', 'abc'])(
    'T-F03: stake %j fica fora da soma e é contado como inválido',
    (stake) => {
      const r = totalDoRascunho(CARDAPIO, {
        'm-dps': { opcao: 'c-outro', stake: '300' },
        'm-fd': { opcao: 'c-meu', stake },
      });
      expect(r).toMatchObject({ total: 300, mercadosEscolhidos: 2, stakesInvalidos: 1 });
    },
  );

  it('T-F03: os limites 200 e 1000 valem', () => {
    const r = totalDoRascunho(CARDAPIO, {
      'm-dps': { opcao: 'c-outro', stake: '200' },
      'm-fd': { opcao: 'c-meu', stake: '1000' },
    });
    expect(r).toMatchObject({ total: 1200, stakesInvalidos: 0 });
  });

  it('escolha de mercado que não é do cardápio não entra', () => {
    const r = totalDoRascunho(CARDAPIO, { 'm-outra-rodada': { opcao: 'x', stake: '300' } });
    expect(r.total).toBe(0);
  });
});
