import { describe, expect, it } from 'vitest';
import { ajustarSchema, saldosDaRodadaSchema } from './ledger.js';

/** Pagamento e ajuste no Officer Panel (§16.6, D-11). */
describe('ajustarSchema', () => {
  const ok = { amount: 100, reason: 'kill conferida à mão', correctsEntryId: '42' };

  it('valor inteiro com sinal, motivo e o lançamento corrigido', () => {
    expect(ajustarSchema.parse(ok)).toEqual(ok);
    expect(ajustarSchema.safeParse({ ...ok, amount: -50 }).success).toBe(true);
  });

  it('recusa zero, fração, motivo vazio e id que não é número', () => {
    expect(ajustarSchema.safeParse({ ...ok, amount: 0 }).success).toBe(false);
    expect(ajustarSchema.safeParse({ ...ok, amount: 10.5 }).success).toBe(false);
    expect(ajustarSchema.safeParse({ ...ok, reason: '  ' }).success).toBe(false);
    expect(ajustarSchema.safeParse({ ...ok, correctsEntryId: 'abc' }).success).toBe(false);
  });
});

describe('saldosDaRodadaSchema', () => {
  it('um total por membro — sem apostas, stake ou escolha', () => {
    const vista = { saldos: [{ slipId: 's1', ownerBattletag: 'Membro#1', devido: 1440, pago: 0 }] };
    expect(saldosDaRodadaSchema.parse(vista)).toEqual(vista);
    expect(
      saldosDaRodadaSchema.safeParse({ saldos: [{ ...vista.saldos[0], stake: 600 }] }).success,
    ).toBe(false);
  });
});
