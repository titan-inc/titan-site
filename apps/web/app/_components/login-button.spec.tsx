// @vitest-environment jsdom

import type { SessionUser } from '@titan/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LoginButton } from './login-button';

/**
 * O que este arquivo protege é uma única propriedade: **o login é um `<a>`**.
 *
 * Parece pequeno e não é. Enquanto era `<button onClick={window.open}>`, o fim
 * do login dependia de `BroadcastChannel`, polling e uma carência para adivinhar
 * por que a janela fechou — e um login bem-sucedido chegava à tela como erro de
 * cancelamento (TIT-144, TIT-148). Sendo link, o navegador navega e a resposta
 * do callback já traz cookie e destino.
 */
const sessao = { battletag: 'Fulano#1234' } as SessionUser;

describe('LoginButton', () => {
  afterEach(cleanup);

  it('sem sessão, é um link para o início do OAuth no Nest', () => {
    render(<LoginButton sessao={null} />);

    const link = screen.getByRole('link', { name: 'Acesse com a Battle.net' });
    expect(link.getAttribute('href')).toContain('/auth/battlenet');
  });

  // Se isto virar botão de novo, volta junto todo o maquinário de janela.
  it('sem sessão, NÃO é botão', () => {
    render(<LoginButton sessao={null} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('com sessão, aponta para a área interna', () => {
    render(<LoginButton sessao={sessao} />);

    expect(screen.getByRole('link', { name: 'Área de membros' }).getAttribute('href')).toBe(
      '/interno',
    );
  });

  // A variante compacta da navbar mobile some com o rótulo visível, então o
  // nome acessível é a única coisa que sobra para quem usa leitor de tela.
  it('compacto mantém o nome acessível', () => {
    render(<LoginButton sessao={null} compacto />);

    expect(screen.getByRole('link', { name: 'Acesse com a Battle.net' })).toBeTruthy();
  });
});
