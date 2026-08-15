// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlesDaSessao } from './controles-da-sessao';

describe('ControlesDaSessao', () => {
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

  it('em rascunho, oferece abrir para respostas', () => {
    render(<ControlesDaSessao sessionId="s" status="rascunho" aoMudar={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Abrir para respostas' })).toBeTruthy();
  });

  it('em aberta, oferece fechar as respostas', () => {
    // Os botões vêm de `proximosEstados()`, a mesma função que o serviço usa
    // para decidir o que aceitar. Listar as transições à mão aqui criaria dois
    // lugares para divergirem, e o sintoma seria um botão que a API recusa.
    render(<ControlesDaSessao sessionId="s" status="aberta" aoMudar={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Fechar as respostas' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Encerrar sessão' })).toBeNull();
  });

  it('em deliberando, oferece encerrar', () => {
    render(<ControlesDaSessao sessionId="s" status="deliberando" aoMudar={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Encerrar sessão' })).toBeTruthy();
  });

  it('encerrada não oferece nada', () => {
    render(<ControlesDaSessao sessionId="s" status="encerrada" aoMudar={vi.fn()} />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(/está encerrada/)).toBeTruthy();
  });

  it('mostra a recusa da API como ela veio', async () => {
    // Ao recusar o encerramento a API diz QUANTAS peças faltam. É exatamente o
    // que o loot master precisa saber para agir; um texto genérico esconderia.
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ message: '6 de 7 peças ainda não foram entregues.' }),
    } as unknown as Response);

    render(<ControlesDaSessao sessionId="s" status="deliberando" aoMudar={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Encerrar sessão' }));

    expect(await screen.findByText(/6 de 7 peças/)).toBeTruthy();
  });
});
