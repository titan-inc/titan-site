import { describe, expect, it } from 'vitest';
import { lootSessionRealtimeConfigSchema } from './loot-session-realtime.js';

describe('lootSessionRealtimeConfigSchema', () => {
  it('preenche os dois padrões quando nada vem', () => {
    expect(lootSessionRealtimeConfigSchema.parse({})).toEqual({
      throttleMs: 1000,
      jitterMs: 300,
    });
  });

  it('aceita valor explícito dentro da faixa', () => {
    expect(lootSessionRealtimeConfigSchema.parse({ throttleMs: 500, jitterMs: 100 })).toEqual({
      throttleMs: 500,
      jitterMs: 100,
    });
  });

  it('aceita jitter zero — desliga o espalhamento', () => {
    expect(
      lootSessionRealtimeConfigSchema.safeParse({ throttleMs: 1000, jitterMs: 0 }).success,
    ).toBe(true);
  });

  it('aceita jitter igual ao throttle', () => {
    expect(
      lootSessionRealtimeConfigSchema.safeParse({ throttleMs: 500, jitterMs: 500 }).success,
    ).toBe(true);
  });

  it('recusa jitter maior que o throttle', () => {
    // Regra que cruza os dois campos: jitter maior atropelaria o refetch de um
    // aviso no do aviso seguinte.
    const resultado = lootSessionRealtimeConfigSchema.safeParse({
      throttleMs: 500,
      jitterMs: 501,
    });
    expect(resultado.success).toBe(false);
  });

  it('recusa throttle fora da faixa 250–10000', () => {
    expect(lootSessionRealtimeConfigSchema.safeParse({ throttleMs: 249 }).success).toBe(false);
    expect(lootSessionRealtimeConfigSchema.safeParse({ throttleMs: 10_001 }).success).toBe(false);
  });

  it('recusa jitter fora da faixa 0–2000', () => {
    expect(lootSessionRealtimeConfigSchema.safeParse({ jitterMs: -1 }).success).toBe(false);
    expect(lootSessionRealtimeConfigSchema.safeParse({ jitterMs: 2001 }).success).toBe(false);
  });

  it('recusa não-inteiro', () => {
    expect(lootSessionRealtimeConfigSchema.safeParse({ throttleMs: 500.5 }).success).toBe(false);
  });
});
