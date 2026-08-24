// @vitest-environment jsdom

import type { Candidato, LootCouncilPanel } from '@titan/shared';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuadroDoConselho } from './quadro-do-conselho';

/** Nomes fictícios — o repo é público. */
const candidato = (over: Partial<Candidato> = {}): Candidato => ({
  name: 'Fulano',
  realm: 'azralon',
  nameKey: 'fulano',
  realmKey: 'azralon',
  respondeu: true,
  responseOptionSlug: 'bis',
  roll: 63,
  note: null,
  aguardandoNovaResposta: false,
  votos: 0,
  meuVoto: false,
  recebidoAntes: [],
  ...over,
});

const painel = (over: Partial<LootCouncilPanel> = {}): LootCouncilPanel => ({
  sessionId: 'sess-1',
  lootMasterBattletag: 'Loot#0001',
  itens: [{ itemId: 'item-1', candidatos: [candidato()], award: null }],
  ...over,
});

const NOMES = new Map([['item-1', { nome: 'Ashen Sigil', icone: null }]]);

describe('QuadroDoConselho', () => {
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

  it('mostra o que o conselho precisa para decidir', () => {
    render(
      <QuadroDoConselho painel={painel()} nomeDosItens={NOMES} podeDecidir aoAgir={vi.fn()} />,
    );

    expect(screen.getByText('bis')).toBeTruthy();
    expect(screen.getByText('63')).toBeTruthy();
    expect(screen.getByText('nada')).toBeTruthy();
  });

  it('na fase de roll mostra QUEM respondeu, sem a escolha', () => {
    // A API já manda escolha e roll nulos com `respondeu: true` (TIT-131). A
    // tela não pode transformar isso em "não respondeu".
    const p = painel({
      itens: [
        {
          itemId: 'item-1',
          candidatos: [candidato({ responseOptionSlug: null, roll: null, respondeu: true })],
          award: null,
        },
      ],
    });

    render(<QuadroDoConselho painel={p} nomeDosItens={NOMES} podeDecidir aoAgir={vi.fn()} />);

    expect(screen.getByText('respondeu')).toBeTruthy();
  });

  it('quem não declarou nada não pode ser votado nem receber entrega direta', () => {
    // A API recusaria os dois. Botão morto é pior que botão ausente — e o
    // caminho para essa pessoa é `passar peça`.
    const p = painel({
      itens: [
        {
          itemId: 'item-1',
          candidatos: [candidato({ responseOptionSlug: 'noop', roll: null })],
          award: null,
        },
      ],
    });

    render(<QuadroDoConselho painel={p} nomeDosItens={NOMES} podeDecidir aoAgir={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'votar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'entregar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'passar peça' })).toBeTruthy();
  });

  it('votar chama a rota de voto com o personagem', async () => {
    render(
      <QuadroDoConselho painel={painel()} nomeDosItens={NOMES} podeDecidir aoAgir={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'votar' }));

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain('/itens/item-1/voto');
    expect(String(init?.body)).toContain('"characterName":"Fulano"');
  });

  it('passar peça pede a razão antes de mandar', async () => {
    render(
      <QuadroDoConselho painel={painel()} nomeDosItens={NOMES} podeDecidir aoAgir={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'passar peça' }));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'banking' }));

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain('/pass-item-to');
    expect(String(init?.body)).toContain('"responseOptionSlug":"banking"');
  });

  it('peça entregue mostra quem levou e some com as ações', () => {
    const p = painel({
      itens: [
        {
          itemId: 'item-1',
          candidatos: [candidato()],
          award: {
            winnerName: 'Fulano',
            winnerRealm: 'azralon',
            responseOptionSlug: 'bis',
            votes: 2,
            awardedByBattletag: 'Loot#0001',
            awardedAt: '2026-08-15T01:00:00.000Z',
            note: 'nunca recebeu nada',
          },
        },
      ],
    });

    render(<QuadroDoConselho painel={p} nomeDosItens={NOMES} podeDecidir aoAgir={vi.fn()} />);

    expect(screen.getByText(/Fulano levou como bis/)).toBeTruthy();
    expect(screen.getByText(/nunca recebeu nada/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'entregar' })).toBeNull();
  });

  it('a entrega em massa mostra o que pulou, com o motivo', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          resultado: {
            entregues: 1,
            pulados: [{ itemId: 'item-2', motivo: 'o conselho ainda não votou nesta peça' }],
          },
        }),
    } as unknown as Response);

    render(
      <QuadroDoConselho painel={painel()} nomeDosItens={NOMES} podeDecidir aoAgir={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Entregar tudo por votos' }));

    expect(await screen.findByText('1 peça entregue')).toBeTruthy();
    expect(screen.getByText(/ainda não votou/)).toBeTruthy();
  });

  it('na fase de roll não oferece votar nem entregar', async () => {
    // A API recusa fora de `deliberando`. Botão que existe para dar erro é pior
    // que botão ausente — e a tela diz quando eles voltam.
    render(
      <QuadroDoConselho
        painel={painel()}
        nomeDosItens={NOMES}
        podeDecidir={false}
        aoAgir={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'votar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'passar peça' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Entregar tudo por votos' })).toBeNull();
    expect(screen.getByText(/abrem quando você fechar as respostas/)).toBeTruthy();
  });

  it('mostra a mensagem da API quando ela recusa', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ message: 'Esta peça já foi entregue por outro conselheiro' }),
    } as unknown as Response);

    render(
      <QuadroDoConselho painel={painel()} nomeDosItens={NOMES} podeDecidir aoAgir={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'entregar' }));

    expect(await screen.findByText(/já foi entregue por outro/)).toBeTruthy();
  });
});
