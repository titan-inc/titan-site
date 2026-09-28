// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TotalFlutuante } from './total-flutuante';

/** D-79 — a barra flutuante com o total do rascunho. */

const RESUMO = { total: 1500, mercadosEscolhidos: 2, mercadosTotal: 5, stakesInvalidos: 0 };

describe('TotalFlutuante', () => {
  afterEach(cleanup);

  it('T-F04: mostra o total em gold e quantos mercados estão preenchidos', () => {
    render(<TotalFlutuante resumo={RESUMO} alterado={false} />);
    expect(screen.getByText(/1\.500 gold/)).toBeTruthy();
    expect(screen.getByText(/2 de 5 mercados/)).toBeTruthy();
    expect(screen.queryByText(/não salvo/i)).toBeNull();
    expect(screen.queryByText(/fora de 200/i)).toBeNull();
  });

  it('T-F05: avisa do stake fora do limite e do que ainda não foi salvo', () => {
    render(<TotalFlutuante resumo={{ ...RESUMO, stakesInvalidos: 2 }} alterado />);
    expect(screen.getByText(/não salvo/i)).toBeTruthy();
    expect(screen.getByText(/2 stakes fora de 200–1\.000/i)).toBeTruthy();
  });

  it('T-F05: singular para um stake inválido', () => {
    render(<TotalFlutuante resumo={{ ...RESUMO, stakesInvalidos: 1 }} alterado={false} />);
    expect(screen.getByText(/1 stake fora de 200–1\.000/i)).toBeTruthy();
  });

  it('T-F06: é uma região de status, fixa na base da tela', () => {
    render(<TotalFlutuante resumo={RESUMO} alterado={false} />);
    const barra = screen.getByRole('status');
    expect(barra.className).toMatch(/sticky/);
    expect(barra.className).toMatch(/bottom-0/);
  });
});
