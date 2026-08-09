import { describe, expect, it } from 'vitest';
import { createApplicationSchema } from './application.js';

const candidaturaValida = {
  characterRealm: 'Thrall — Azralon',
  roleSpec: 'Tank / Protection Warrior',
  contact: 'Discord: thrall.azeroth',
};

describe('createApplicationSchema', () => {
  it('aceita os três campos obrigatórios e informações adicionais ausentes', () => {
    expect(createApplicationSchema.safeParse(candidaturaValida).success).toBe(true);
  });

  it('aceita os limites máximos', () => {
    expect(
      createApplicationSchema.safeParse({
        characterRealm: 'a'.repeat(80),
        roleSpec: 'b'.repeat(80),
        contact: 'c'.repeat(100),
        additionalInfo: 'd'.repeat(2000),
      }).success,
    ).toBe(true);
  });

  it.each([
    ['characterRealm', 'a'.repeat(81)],
    ['roleSpec', 'b'.repeat(81)],
    ['contact', 'c'.repeat(101)],
    ['additionalInfo', 'd'.repeat(2001)],
  ])('rejeita %s acima do limite', (campo, valor) => {
    expect(
      createApplicationSchema.safeParse({ ...candidaturaValida, [campo]: valor }).success,
    ).toBe(false);
  });

  it.each(['characterRealm', 'roleSpec', 'contact'])('exige %s', (campo) => {
    const dados = { ...candidaturaValida } as Record<string, unknown>;
    delete dados[campo];
    expect(createApplicationSchema.safeParse(dados).success).toBe(false);
  });

  it('rejeita honeypot preenchido', () => {
    expect(
      createApplicationSchema.safeParse({ ...candidaturaValida, website: 'spam' }).success,
    ).toBe(false);
  });
});
