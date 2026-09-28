/**
 * Projected payout de uma opção (R-35, D-12; spec §8.4):
 *
 *   projected(o) = floor(9V/10) / S(o)        ("—" se S(o) = 0)
 *
 * `V` é a pool de apostas válidas do mercado e `S(o)` a parte dela na opção. O
 * `floor` é sobre a pool, como no settlement (§8.2) — o número mostrado é o
 * mesmo `P` que seria rateado. `null` é o "—".
 */
export function multiplicadorProjetado(pool: number, naOpcao: number): number | null {
  if (naOpcao <= 0) return null;
  return Math.floor((9 * pool) / 10) / naOpcao;
}
