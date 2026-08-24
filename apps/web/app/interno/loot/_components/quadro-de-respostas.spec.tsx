// @vitest-environment jsdom

import type { LootSessionDetail, LootSessionStatus } from '@titan/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuadroDeRespostas } from './quadro-de-respostas';

/** Nomes fictícios — o repo é público. */
const participante = (nome: string, key: string) => ({
  name: nome,
  realm: 'azralon',
  nameKey: key,
  realmKey: 'azralon',
  battletag: `${nome}#0001`,
  joinedAt: '2026-08-15T01:00:00.000Z',
});

const sessao = (over: Partial<LootSessionDetail> = {}): LootSessionDetail =>
  ({
    id: 'sess-1',
    status: 'aberta' as LootSessionStatus,
    encounter: { encounterId: 'enc-1', name: 'Kazzara', raid: 'Aberrus' },
    difficulty: 'mythic',
    createdByBattletag: 'Loot#0001',
    createdAt: '2026-08-15T01:00:00.000Z',
    openedAt: '2026-08-15T01:05:00.000Z',
    participantes: [participante('Fulano', 'fulano'), participante('Ciclano', 'ciclano')],
    minhaParticipacao: participante('Fulano', 'fulano'),
    opcoesDeResposta: [{ slug: 'bis', label: 'BiS' }],
    items: [
      {
        id: 'item-1',
        position: 1,
        itemId: 202612,
        itemString: 'item:202612',
        itemContext: 6,
        bonusIds: [],
        name: 'Ashen Sigil',
        icon: null,
        equipLoc: 'FINGER',
        looterName: 'Fulano',
        looterRealm: 'azralon',
        minhaResposta: {
          responseOptionSlug: 'bis',
          roll: 63,
          note: null,
          aguardandoNovaResposta: false,
          characterName: 'Fulano',
        },
        totalDeRespostas: 2,
        respostas: [],
      },
    ],
    ...over,
  }) as LootSessionDetail;

describe('QuadroDeRespostas', () => {
  afterEach(cleanup);

  it('lista TODO participante, mesmo quem não respondeu', () => {
    // Sumir com quem não respondeu faria a lista parecer menor que a raid.
    render(<QuadroDeRespostas sessao={sessao()} aoAbrirCard={vi.fn()} />);

    expect(screen.getByText('Ciclano')).toBeTruthy();
  });

  it('na fase de roll mostra a PRÓPRIA resposta e esconde a alheia', () => {
    // A API já manda `respostas` vazio; o que se testa aqui é que a tela não
    // inventa nada por conta própria e ainda assim mostra a sua.
    render(<QuadroDeRespostas sessao={sessao()} aoAbrirCard={vi.fn()} />);

    expect(screen.getByText('63')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('avisa que as respostas abrem quando a fase de roll fechar', () => {
    render(<QuadroDeRespostas sessao={sessao()} aoAbrirCard={vi.fn()} />);

    expect(screen.getByText(/aparecem para todo mundo/)).toBeTruthy();
  });

  it('em deliberando mostra a resposta e a nota de todo mundo', () => {
    const s = sessao({ status: 'deliberando' });
    const item = s.items[0];
    if (item === undefined) throw new Error('fixture sem item');
    item.respostas = [
      { name: 'Fulano', realm: 'azralon', responseOptionSlug: 'bis', roll: 63, note: null },
      {
        name: 'Ciclano',
        realm: 'azralon',
        responseOptionSlug: 'upgrade',
        roll: 12,
        note: 'tanko o segundo boss',
      },
    ];

    render(<QuadroDeRespostas sessao={s} aoAbrirCard={null} />);

    expect(screen.getByText('upgrade')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('tanko o segundo boss')).toBeTruthy();
  });

  it('sem poder responder, não oferece o botão de responder', () => {
    // `aoAbrirCard` nulo é a sessão que não aceita resposta agora. O botão some
    // porque a API recusaria — botão morto é pior que botão ausente.
    render(<QuadroDeRespostas sessao={sessao({ status: 'deliberando' })} aoAbrirCard={null} />);

    expect(screen.queryByRole('button', { name: /responder/ })).toBeNull();
  });

  it('marca a aba da peça sem resposta', () => {
    const s = sessao();
    const item = s.items[0];
    if (item === undefined) throw new Error('fixture sem item');
    item.minhaResposta = null;

    render(<QuadroDeRespostas sessao={s} aoAbrirCard={vi.fn()} />);

    expect(screen.getByLabelText('sem resposta')).toBeTruthy();
  });

  it('mostra quantos já responderam', () => {
    render(<QuadroDeRespostas sessao={sessao()} aoAbrirCard={vi.fn()} />);

    expect(screen.getByText('2 de 2 responderam')).toBeTruthy();
  });

  it('não imprime fração impossível quando há mais resposta que participante', () => {
    // Acontece nas sessões anteriores à TIT-126, onde se respondia sem entrar.
    // "3 de 1 responderam" na tela de quem está raidando é pior que só a
    // contagem.
    const s = sessao();
    const item = s.items[0];
    if (item === undefined) throw new Error('fixture sem item');
    item.totalDeRespostas = 3;
    s.participantes = [participante('Fulano', 'fulano')];

    render(<QuadroDeRespostas sessao={s} aoAbrirCard={vi.fn()} />);

    expect(screen.getByText('3 responderam')).toBeTruthy();
  });

  it('quem respondeu sem estar na lista de participantes ainda aparece', () => {
    // Mesma origem: resposta que existe e não aparece é pior que uma linha a
    // mais na tabela.
    const s = sessao({ status: 'deliberando' });
    const item = s.items[0];
    if (item === undefined) throw new Error('fixture sem item');
    s.participantes = [participante('Fulano', 'fulano')];
    item.respostas = [
      { name: 'Fulano', realm: 'azralon', responseOptionSlug: 'bis', roll: 63, note: null },
      { name: 'DeAntes', realm: 'azralon', responseOptionSlug: 'pass', roll: 9, note: null },
    ];

    render(<QuadroDeRespostas sessao={s} aoAbrirCard={null} />);

    expect(screen.getByText('DeAntes')).toBeTruthy();
    expect(screen.getByText('pass')).toBeTruthy();
  });
});
