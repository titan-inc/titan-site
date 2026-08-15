// @vitest-environment jsdom

import type { CharacterRef } from '@titan/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntrarNaSessao } from './entrar-na-sessao';

/** Nomes fictícios, do melhor rank para o pior — a ordem que a API manda. */
const PERSONAGENS: CharacterRef[] = [
  { name: 'Fulano', realm: 'azralon', region: 'us' },
  { name: 'Ciclano', realm: 'area-52', region: 'us' },
];

const participacao = {
  name: 'Ciclano',
  realm: 'area-52',
  nameKey: 'ciclano',
  realmKey: 'area52',
  battletag: 'Alguem#0001',
  joinedAt: '2026-08-15T01:00:00.000Z',
};

describe('EntrarNaSessao', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('entra com o representante da conta sem escolher nada', async () => {
    // A API manda a lista do melhor rank para o pior, então o primeiro já vem
    // selecionado — quem raida no main não toca no select.
    render(
      <EntrarNaSessao
        sessionId="sess-1"
        personagens={PERSONAGENS}
        participacao={null}
        encerrada={false}
        aoEntrar={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls[0]?.[1]?.body).toContain('"characterName":"Fulano"');
    });
  });

  it('dá para entrar com um alt', async () => {
    render(
      <EntrarNaSessao
        sessionId="sess-1"
        personagens={PERSONAGENS}
        participacao={null}
        encerrada={false}
        aoEntrar={vi.fn()}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Entrar como'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls[0]?.[1]?.body).toContain('"characterName":"Ciclano"');
    });
  });

  it('quem já entrou vê com qual personagem está', () => {
    render(
      <EntrarNaSessao
        sessionId="sess-1"
        personagens={PERSONAGENS}
        participacao={participacao}
        encerrada={false}
        aoEntrar={vi.fn()}
      />,
    );

    expect(screen.getByText('Ciclano')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Entrar' })).toBeNull();
  });

  it('mostra a mensagem da API quando ela recusa', async () => {
    // A API recusa trocar de personagem depois de responder, e a mensagem dela
    // diz o caminho ("peça ao conselho para reabrir"). Trocar por um texto
    // genérico esconderia isso de quem precisa agir.
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ message: 'Você já respondeu com Ciclano nesta sessão.' }),
    } as unknown as Response);

    render(
      <EntrarNaSessao
        sessionId="sess-1"
        personagens={PERSONAGENS}
        participacao={null}
        encerrada={false}
        aoEntrar={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText(/já respondeu com Ciclano/)).toBeTruthy();
  });

  it('conta sem personagem no roster não vê formulário nenhum', () => {
    render(
      <EntrarNaSessao
        sessionId="sess-1"
        personagens={[]}
        participacao={null}
        encerrada={false}
        aoEntrar={vi.fn()}
      />,
    );

    expect(screen.getByText(/não tem personagem no roster/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Entrar' })).toBeNull();
  });

  it('sessão encerrada não oferece entrar', () => {
    render(
      <EntrarNaSessao
        sessionId="sess-1"
        personagens={PERSONAGENS}
        participacao={null}
        encerrada
        aoEntrar={vi.fn()}
      />,
    );

    expect(screen.getByText(/já encerrou/)).toBeTruthy();
  });
});
