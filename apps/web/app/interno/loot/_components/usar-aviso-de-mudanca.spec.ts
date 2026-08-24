// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAvisoDeMudanca } from './usar-aviso-de-mudanca';

/**
 * jsdom não implementa `EventSource`. Este dublê guarda as instâncias
 * criadas para os testes inspecionarem URL/credenciais, e deixa disparar
 * eventos nomeados (`ola`) e o evento sem nome (`onmessage`) à mão.
 */
class EventSourceFalso {
  static instancias: EventSourceFalso[] = [];

  fechado = false;
  private ouvintes: Record<string, Array<(e: MessageEvent) => void>> = {};
  onmessage: ((e: MessageEvent) => void) | null = null;

  constructor(
    readonly url: string,
    readonly opcoes?: { withCredentials?: boolean },
  ) {
    EventSourceFalso.instancias.push(this);
  }

  addEventListener(tipo: string, ouvinte: (e: MessageEvent) => void): void {
    (this.ouvintes[tipo] ??= []).push(ouvinte);
  }

  disparar(tipo: string, data?: string): void {
    const evento = { data } as MessageEvent;
    for (const ouvinte of this.ouvintes[tipo] ?? []) ouvinte(evento);
  }

  mudou(): void {
    this.onmessage?.({} as MessageEvent);
  }

  close(): void {
    this.fechado = true;
  }
}

describe('useAvisoDeMudanca', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    EventSourceFalso.instancias = [];
    vi.stubGlobal('EventSource', EventSourceFalso);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function instanciaAtual(): EventSourceFalso {
    const i = EventSourceFalso.instancias.at(-1);
    if (!i) throw new Error('nenhum EventSource foi aberto');
    return i;
  }

  it('conecta no endpoint da sessão, com credenciais', () => {
    renderHook(() => useAvisoDeMudanca('sess-1', vi.fn()));

    const es = instanciaAtual();
    expect(es.url).toContain('/internal/loot-sessions/sess-1/mudancas');
    expect(es.opcoes).toEqual({ withCredentials: true });
  });

  it('fecha a conexão ao desmontar', () => {
    const { unmount } = renderHook(() => useAvisoDeMudanca('sess-1', vi.fn()));
    const es = instanciaAtual();

    unmount();

    expect(es.fechado).toBe(true);
  });

  it('reabre a conexão quando a sessão muda', () => {
    const { rerender } = renderHook(({ id }) => useAvisoDeMudanca(id, vi.fn()), {
      initialProps: { id: 'sess-1' },
    });
    expect(EventSourceFalso.instancias).toHaveLength(1);
    expect(EventSourceFalso.instancias[0]?.fechado).toBe(false);

    rerender({ id: 'sess-2' });

    expect(EventSourceFalso.instancias).toHaveLength(2);
    expect(EventSourceFalso.instancias[0]?.fechado).toBe(true);
    expect(instanciaAtual().url).toContain('sess-2');
  });

  it('NÃO reabre a conexão só porque o callback mudou de identidade', () => {
    // Sem isto, um `aoMudar` inline (arrow function nova a cada render, como
    // o `recarregar` do SessaoAoVivo) derrubaria e reabriria o stream a cada
    // render — é para isso que o hook guarda o callback numa ref.
    const { rerender } = renderHook(({ cb }) => useAvisoDeMudanca('sess-1', cb), {
      initialProps: { cb: vi.fn() },
    });

    rerender({ cb: vi.fn() });

    expect(EventSourceFalso.instancias).toHaveLength(1);
  });

  it('espalha a reação com o jitter que veio no evento "ola"', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const aoMudar = vi.fn();
    renderHook(() => useAvisoDeMudanca('sess-1', aoMudar));
    const es = instanciaAtual();

    es.disparar('ola', JSON.stringify({ jitterMs: 300 }));
    es.mudou();

    expect(aoMudar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(149); // 0.5 * 300 = 150ms
    expect(aoMudar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it('jitter 0 (ou nenhuma saudação ainda) reage sem atraso perceptível', () => {
    const aoMudar = vi.fn();
    renderHook(() => useAvisoDeMudanca('sess-1', aoMudar));
    const es = instanciaAtual();

    // Nenhum "ola" chegou ainda — o hook não inventa um número, mas também
    // não trava esperando por ele.
    es.mudou();

    vi.advanceTimersByTime(0);
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it('não chama o callback se desmontar antes do atraso do jitter passar', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const aoMudar = vi.fn();
    const { unmount } = renderHook(() => useAvisoDeMudanca('sess-1', aoMudar));
    const es = instanciaAtual();

    es.disparar('ola', JSON.stringify({ jitterMs: 2000 }));
    es.mudou();
    unmount();

    vi.advanceTimersByTime(2000);
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it('sempre chama a versão MAIS RECENTE do callback, mesmo sem reabrir a conexão', () => {
    const primeiro = vi.fn();
    const segundo = vi.fn();
    const { rerender } = renderHook(({ cb }) => useAvisoDeMudanca('sess-1', cb), {
      initialProps: { cb: primeiro },
    });
    rerender({ cb: segundo });

    instanciaAtual().mudou();
    vi.advanceTimersByTime(0);

    expect(primeiro).not.toHaveBeenCalled();
    expect(segundo).toHaveBeenCalledTimes(1);
  });
});
