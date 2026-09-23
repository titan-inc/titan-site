import { multiplicadorProjetado } from './odds';

/**
 * T-O01 — projected payout (R-35, D-12; spec §8.4):
 * `projected(o) = floor(9V/10) / S(o)`, e "—" quando `S(o) = 0`.
 */
describe('multiplicadorProjetado', () => {
  it('pool de 1.000 com 300 na opção → 900/300 = 3×', () => {
    expect(multiplicadorProjetado(1000, 300)).toBe(3);
  });

  it('o floor é sobre a pool, antes da divisão: 1.001 → P = 900', () => {
    expect(multiplicadorProjetado(1001, 300)).toBe(3);
    expect(multiplicadorProjetado(1010, 300)).toBe(909 / 300);
  });

  it('opção sem aposta → nulo ("—"), não zero nem infinito', () => {
    expect(multiplicadorProjetado(1000, 0)).toBeNull();
    expect(multiplicadorProjetado(0, 0)).toBeNull();
  });

  it('piso de 0,9× quando a pool inteira está na opção', () => {
    expect(multiplicadorProjetado(1000, 1000)).toBe(0.9);
  });
});
