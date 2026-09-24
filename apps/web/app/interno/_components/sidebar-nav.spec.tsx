// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarNav } from './sidebar-nav';

vi.mock('next/navigation', () => ({ useSelectedLayoutSegment: () => null }));

describe('SidebarNav — Titan Bet (D-01)', () => {
  afterEach(cleanup);

  it('aparece para qualquer um na guilda, inclusive acima do corte de rank', () => {
    render(<SidebarNav acessoInterno={false} />);
    expect(screen.getByRole('link', { name: 'Titan Bet' }).getAttribute('href')).toBe(
      '/interno/bet',
    );
  });

  it('e para o time de raid', () => {
    render(<SidebarNav acessoInterno />);
    expect(screen.getByRole('link', { name: 'Titan Bet' })).toBeTruthy();
  });
});

describe('SidebarNav — Officer Panel do Titan Bet (D-36)', () => {
  afterEach(cleanup);

  it('aparece para officer', () => {
    render(<SidebarNav officer />);
    expect(screen.getByRole('link', { name: 'Titan Bet (officer)' }).getAttribute('href')).toBe(
      '/interno/bet-officer',
    );
  });

  it('some para quem não é — é cortesia; quem barra é o OfficerGuard (Regra 5)', () => {
    render(<SidebarNav />);
    expect(screen.queryByRole('link', { name: 'Titan Bet (officer)' })).toBeNull();
  });
});
