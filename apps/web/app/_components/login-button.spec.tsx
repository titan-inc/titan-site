// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANAL_LOGIN } from '../../lib/auth/canal';
import { LoginButton } from './login-button';

/**
 * O lado do login que não tinha teste — e onde estavam os três defeitos da
 * TIT-144. O que estes testes travam é a promessa central: **o fim do login
 * não depende de o popup conseguir avisar**.
 */

/**
 * jsdom não implementa `<dialog>`. `ModalErroLogin` chama `showModal()`, então
 * sem isto qualquer teste que produza erro estoura antes de asseverar nada.
 */
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function abrir(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function fechar(this: HTMLDialogElement) {
    this.open = false;
  };
});

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const fetchMock = vi.fn();
let janelaFalsa: { closed: boolean; focus: () => void; close: () => void };

/** Resposta de `/api/sessao`. */
function sessao(autenticado: boolean) {
  return new Response(JSON.stringify({ autenticado }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(sessao(false));

  janelaFalsa = { closed: false, focus: vi.fn(), close: vi.fn() };
  vi.stubGlobal(
    'open',
    vi.fn(() => janelaFalsa),
  );
  vi.stubGlobal('screen', { availWidth: 1920, availHeight: 1080 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function clicarEntrar() {
  render(<LoginButton sessao={null} />);
  await userEvent.click(screen.getByRole('button', { name: 'Acesse com a Battle.net' }));
}

describe('LoginButton', () => {
  it('conclui o login mesmo sem aviso nenhum do popup', async () => {
    // O caso do opener cortado: ninguém avisa a mãe. Antes isso terminava em
    // timeout depois de 3 minutos; agora a verificação de sessão resolve.
    await clicarEntrar();
    expect(screen.getByRole('button').textContent).toContain('Aguardando Battle.net…');

    fetchMock.mockResolvedValue(sessao(true));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/interno'), { timeout: 4000 });
    // Sem o refresh a navbar continuaria oferecendo "Acesse com a Battle.net".
    expect(refresh).toHaveBeenCalled();
  });

  it('continua ouvindo um login demorado, em vez de desistir antes do backend', async () => {
    // O cookie de OAuth dura 6h para cobrir 2FA e senha esquecida. Uma mãe que
    // desiste antes disso faz o login dar certo sem ninguém aproveitar: a
    // sessão nasce e a tela continua oferecendo o botão de entrar.
    await clicarEntrar();

    // Vários ciclos de verificação com a pessoa ainda na tela da Blizzard.
    await new Promise((r) => setTimeout(r, 2500));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('button').textContent).toContain('Aguardando Battle.net…');

    fetchMock.mockResolvedValue(sessao(true));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/interno'), { timeout: 4000 });
  });

  it('não acusa cancelamento quando o popup fecha por ter dado certo', async () => {
    // O sintoma que abriu a issue: fechar a janela é o ÚLTIMO passo de um login
    // bem-sucedido, então "fechou" sozinho não prova desistência.
    await clicarEntrar();

    janelaFalsa.closed = true;
    fetchMock.mockResolvedValue(sessao(true));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/interno'), { timeout: 4000 });
    expect(screen.queryByText(/cancelou a autorização/i)).toBeNull();
  });

  it('acusa cancelamento quando fecha e a sessão não nasce', async () => {
    await clicarEntrar();
    janelaFalsa.closed = true;

    await waitFor(() => expect(screen.getByText(/cancelou a autorização/i)).toBeTruthy(), {
      timeout: 8000,
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('o aviso do canal adianta, mas não é acreditado sozinho', async () => {
    // `status: 'ok'` sem sessão de verdade não navega. O canal só antecipa o
    // que a verificação diria — nunca inventa uma sessão.
    await clicarEntrar();

    const canal = new BroadcastChannel(CANAL_LOGIN);
    canal.postMessage({ tipo: 'titan-oauth', status: 'ok' });

    await new Promise((r) => setTimeout(r, 200));
    expect(push).not.toHaveBeenCalled();
    canal.close();
  });

  it('erro vindo do canal vira modal, sem navegar', async () => {
    await clicarEntrar();

    const canal = new BroadcastChannel(CANAL_LOGIN);
    canal.postMessage({ tipo: 'titan-oauth', status: 'erro', motivo: 'state' });

    await waitFor(() => expect(screen.getByText(/não pôde ser validado/i)).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
    canal.close();
  });

  it('popup bloqueado pelo navegador vira modal com instrução', async () => {
    vi.stubGlobal(
      'open',
      vi.fn(() => null),
    );
    await clicarEntrar();

    expect(screen.getByText(/bloqueou a janela de login/i)).toBeTruthy();
  });
});
