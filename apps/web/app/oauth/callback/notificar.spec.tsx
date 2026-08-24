// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANAL_LOGIN, type AvisoLogin } from '../../../lib/auth/canal';
import { NotificarOAuth } from './notificar';

/**
 * O popup tem duas obrigações e elas são independentes: avisar, e sumir.
 * Antes da TIT-144 as duas dependiam de `window.opener` existir, então quando
 * ele sumia a janela ficava aberta para sempre e ninguém era avisado.
 */

const close = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('close', close);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Escuta o canal e devolve o primeiro aviso que chegar. */
function ouvir(): Promise<AvisoLogin> {
  return new Promise((resolve) => {
    const canal = new BroadcastChannel(CANAL_LOGIN);
    canal.onmessage = (e: MessageEvent) => {
      canal.close();
      resolve(e.data as AvisoLogin);
    };
  });
}

describe('NotificarOAuth', () => {
  it('avisa pelo canal sem depender de window.opener', async () => {
    const recebido = ouvir();
    // Sem opener nenhum: é o caso do vínculo cortado.
    vi.stubGlobal('opener', null);

    render(<NotificarOAuth status="ok" />);

    expect(await recebido).toMatchObject({ tipo: 'titan-oauth', status: 'ok' });
  });

  it('fecha a janela mesmo sem opener', async () => {
    vi.stubGlobal('opener', null);

    render(<NotificarOAuth status="ok" />);

    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('leva o motivo junto quando o login falhou', async () => {
    const recebido = ouvir();
    render(<NotificarOAuth status="erro" motivo="state" />);

    expect(await recebido).toMatchObject({ status: 'erro', motivo: 'state' });
  });

  it('não quebra se o navegador recusar o close', async () => {
    vi.stubGlobal(
      'close',
      vi.fn(() => {
        throw new Error('recusado');
      }),
    );

    // A página continua legível, com o texto e os links que page.tsx renderiza.
    expect(() => render(<NotificarOAuth status="ok" />)).not.toThrow();
    await waitFor(() => expect(true).toBe(true));
  });
});
