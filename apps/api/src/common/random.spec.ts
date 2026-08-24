import { amostraUm, amostrarAte, embaralhar, sortearEntre } from './random';

describe('sortearEntre', () => {
  it('nunca sai da faixa, inclusive nas pontas', () => {
    for (let i = 0; i < 200; i++) {
      const valor = sortearEntre(3, 6);
      expect(valor).toBeGreaterThanOrEqual(3);
      expect(valor).toBeLessThanOrEqual(6);
    }
  });

  it('min === max devolve sempre o mesmo valor', () => {
    expect(sortearEntre(5, 5)).toBe(5);
  });
});

describe('amostraUm', () => {
  it('devolve um elemento do array', () => {
    const itens = ['a', 'b', 'c'];
    expect(itens).toContain(amostraUm(itens));
  });

  it('lança com array vazio', () => {
    expect(() => amostraUm([])).toThrow(/vazio/);
  });
});

describe('embaralhar', () => {
  it('devolve a mesma quantidade de elementos, sem repetir nem sumir nenhum', () => {
    const itens = [1, 2, 3, 4, 5];
    const embaralhado = embaralhar(itens);

    expect(embaralhado).toHaveLength(itens.length);
    expect([...embaralhado].sort()).toEqual([...itens].sort());
  });

  it('não muta o array original', () => {
    const itens = [1, 2, 3, 4, 5];
    const copia = [...itens];

    embaralhar(itens);

    expect(itens).toEqual(copia);
  });
});

describe('amostrarAte', () => {
  it('devolve no máximo n elementos, sem repetir', () => {
    const itens = [1, 2, 3, 4, 5];
    const amostra = amostrarAte(itens, 3);

    expect(amostra).toHaveLength(3);
    expect(new Set(amostra).size).toBe(3);
    for (const v of amostra) expect(itens).toContain(v);
  });

  it('n maior que o array devolve tudo, sem duplicar', () => {
    const itens = [1, 2, 3];
    expect(amostrarAte(itens, 10)).toHaveLength(3);
  });

  it('n zero ou negativo devolve vazio', () => {
    expect(amostrarAte([1, 2, 3], 0)).toEqual([]);
    expect(amostrarAte([1, 2, 3], -1)).toEqual([]);
  });
});
