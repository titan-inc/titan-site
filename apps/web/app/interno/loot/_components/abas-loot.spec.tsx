// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbasLoot } from './abas-loot';

const segmentoAtual = vi.fn<() => string | null>();

vi.mock('next/navigation', () => ({
  useSelectedLayoutSegment: () => segmentoAtual(),
}));

describe('AbasLoot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    segmentoAtual.mockReturnValue(null);
  });

  afterEach(cleanup);

  it('mostra Sessão e Histórico para quem não é oficial', () => {
    render(<AbasLoot />);

    expect(screen.getByRole('link', { name: 'Sessão' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Histórico' })).toBeTruthy();
  });

  it('esconde Configuração de quem não é oficial', () => {
    render(<AbasLoot />);

    expect(screen.queryByRole('link', { name: 'Configuração' })).toBeNull();
  });

  it('mostra Configuração para oficial', () => {
    render(<AbasLoot oficial />);

    const aba = screen.getByRole('link', { name: 'Configuração' });
    expect(aba.getAttribute('href')).toBe('/interno/loot/configuracao');
  });

  describe('aba ativa', () => {
    it('a raiz da área é a Sessão, e não nenhuma das filhas', () => {
      // `useSelectedLayoutSegment` devolve null em /interno/loot. Se a aba raiz
      // usasse uma string, ela nunca ficaria ativa — e nenhuma aba pareceria
      // selecionada ao entrar na área.
      segmentoAtual.mockReturnValue(null);
      render(<AbasLoot oficial />);

      expect(screen.getByRole('link', { name: 'Sessão' }).getAttribute('aria-current')).toBe(
        'page',
      );
      expect(
        screen.getByRole('link', { name: 'Histórico' }).getAttribute('aria-current'),
      ).toBeNull();
    });

    it('marca a filha quando se está nela', () => {
      segmentoAtual.mockReturnValue('historico');
      render(<AbasLoot oficial />);

      expect(screen.getByRole('link', { name: 'Histórico' }).getAttribute('aria-current')).toBe(
        'page',
      );
      expect(screen.getByRole('link', { name: 'Sessão' }).getAttribute('aria-current')).toBeNull();
    });
  });
});
