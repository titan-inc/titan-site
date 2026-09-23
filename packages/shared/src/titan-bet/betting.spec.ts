import { describe, expect, it } from 'vitest';
import {
  recusarDepositoSchema,
  salvarSlipSchema,
  STAKE_MAXIMO,
  STAKE_MINIMO,
  submeterSlipSchema,
} from './betting.js';

/**
 * Contrato privado do Bet Slip (Regra 2; spec do Titan Bet §9.1).
 * T-S13 na entrada: stake inteiro de 200 a 1.000 (R-16).
 */
const simples = (stake: unknown) => ({ marketId: 'm1', stake, targetCharacterId: 'c1' });

describe('salvarSlipSchema', () => {
  it('limites vêm da R-16', () => {
    expect([STAKE_MINIMO, STAKE_MAXIMO]).toEqual([200, 1000]);
  });

  it.each([200, 500, 1000])('aceita stake %s', (stake) => {
    expect(salvarSlipSchema.safeParse({ apostas: [simples(stake)] }).success).toBe(true);
  });

  it.each([199, 1001, 0, -200, 200.5, '500', null])('recusa stake %s', (stake) => {
    expect(salvarSlipSchema.safeParse({ apostas: [simples(stake)] }).success).toBe(false);
  });

  it('aceita slip vazio: o rascunho pode não ter aposta nenhuma ainda', () => {
    expect(salvarSlipSchema.safeParse({ apostas: [] }).success).toBe(true);
  });

  // Mudança de produto (D-54): a Weekly deixou de ser um conjunto de 0..N bosses
  // e passou a ser a escolha de um boss de progressão. Substitui o caso antigo
  // "aceita Weekly com 0, 1 e N bosses" (T-S11/T-S22).
  it('T-W11: a Weekly escolhe um boss — um stake, um encounter', () => {
    const aposta = { marketId: 'w', stake: 500, encounterId: 'e1' };
    expect(salvarSlipSchema.safeParse({ apostas: [aposta] }).success).toBe(true);
  });

  it('T-W11: lista de bosses não existe mais na Weekly', () => {
    const aposta = { marketId: 'w', stake: 500, encounterIds: ['e1', 'e2'] };
    expect(salvarSlipSchema.safeParse({ apostas: [aposta] }).success).toBe(false);
  });

  it('recusa aposta sem alvo e sem bosses', () => {
    expect(salvarSlipSchema.safeParse({ apostas: [{ marketId: 'm', stake: 500 }] }).success).toBe(
      false,
    );
  });

  it('recusa aposta com personagem e boss ao mesmo tempo', () => {
    const aposta = { marketId: 'm', stake: 500, targetCharacterId: 'c', encounterId: 'e1' };
    expect(salvarSlipSchema.safeParse({ apostas: [aposta] }).success).toBe(false);
  });

  it('recusa boss vazio na Weekly', () => {
    const aposta = { marketId: 'w', stake: 500, encounterId: '' };
    expect(salvarSlipSchema.safeParse({ apostas: [aposta] }).success).toBe(false);
  });

  it('recusa duas apostas no mesmo mercado (D-28)', () => {
    const r = salvarSlipSchema.safeParse({ apostas: [simples(300), simples(400)] });
    expect(r.success).toBe(false);
  });
});

describe('submeterSlipSchema', () => {
  it('exige o personagem depositante (D-02)', () => {
    expect(submeterSlipSchema.safeParse({ depositCharacterId: 'c1' }).success).toBe(true);
    expect(submeterSlipSchema.safeParse({}).success).toBe(false);
    expect(submeterSlipSchema.safeParse({ depositCharacterId: '' }).success).toBe(false);
  });
});

describe('recusarDepositoSchema', () => {
  it('exige motivo (D-34)', () => {
    expect(recusarDepositoSchema.safeParse({ motivo: 'valor diferente' }).success).toBe(true);
    expect(recusarDepositoSchema.safeParse({ motivo: '   ' }).success).toBe(false);
    expect(recusarDepositoSchema.safeParse({}).success).toBe(false);
  });
});
