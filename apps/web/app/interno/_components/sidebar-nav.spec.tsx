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
