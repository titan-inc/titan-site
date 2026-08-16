import { loadLootSessionRealtimeConfig } from './loot-session-realtime.config';

describe('loadLootSessionRealtimeConfig', () => {
  it('cai nos dois padrões quando nada está definido', () => {
    // Um .env de antes desta issue não pode derrubar a API no boot.
    expect(loadLootSessionRealtimeConfig({})).toEqual({ throttleMs: 1000, jitterMs: 300 });
  });

  it('lê os dois valores do ambiente', () => {
    expect(
      loadLootSessionRealtimeConfig({
        LOOT_SESSION_REALTIME_THROTTLE_MS: '2000',
        LOOT_SESSION_REALTIME_JITTER_MS: '500',
      }),
    ).toEqual({ throttleMs: 2000, jitterMs: 500 });
  });

  it('rejeita throttle fora da faixa 250–10000 — a API não sobe', () => {
    // Mesmo precedente do GUILD_OFFICER_RANK_MAX: falhar no deploy é melhor
    // que rodar a raid com um throttle que não consolida a tempestade.
    expect(() =>
      loadLootSessionRealtimeConfig({ LOOT_SESSION_REALTIME_THROTTLE_MS: '100' }),
    ).toThrow(/inválida/);
    expect(() =>
      loadLootSessionRealtimeConfig({ LOOT_SESSION_REALTIME_THROTTLE_MS: '20000' }),
    ).toThrow(/inválida/);
  });

  it('rejeita jitter fora da faixa 0–2000', () => {
    expect(() => loadLootSessionRealtimeConfig({ LOOT_SESSION_REALTIME_JITTER_MS: '-1' })).toThrow(
      /inválida/,
    );
    expect(() =>
      loadLootSessionRealtimeConfig({ LOOT_SESSION_REALTIME_JITTER_MS: '2500' }),
    ).toThrow(/inválida/);
  });

  it('rejeita jitter maior que o throttle', () => {
    expect(() =>
      loadLootSessionRealtimeConfig({
        LOOT_SESSION_REALTIME_THROTTLE_MS: '500',
        LOOT_SESSION_REALTIME_JITTER_MS: '600',
      }),
    ).toThrow(/inválida/);
  });

  it('aceita jitter igual ao throttle', () => {
    expect(
      loadLootSessionRealtimeConfig({
        LOOT_SESSION_REALTIME_THROTTLE_MS: '500',
        LOOT_SESSION_REALTIME_JITTER_MS: '500',
      }),
    ).toEqual({ throttleMs: 500, jitterMs: 500 });
  });

  it('rejeita valor não numérico — nunca cai em default silencioso', () => {
    expect(() =>
      loadLootSessionRealtimeConfig({ LOOT_SESSION_REALTIME_THROTTLE_MS: 'rápido' }),
    ).toThrow(/inválida/);
  });

  it('aceita jitter zero — desliga o espalhamento', () => {
    expect(loadLootSessionRealtimeConfig({ LOOT_SESSION_REALTIME_JITTER_MS: '0' }).jitterMs).toBe(
      0,
    );
  });
});
