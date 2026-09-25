// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ListaDeRodadas } from './lista-de-rodadas';

/**
 * A lista de rodadas, do membro e do Officer Panel. Achados da validação no
 * navegador (titan-bet-test-design.md §39): B1 e B3.
 */

const RODADA = {
  roundId: 'r1',
  period: 1083,
  // A sexta antes do cutoff: o dia do job que abre a rodada (§9) — não é o reset.
  opensAt: '2026-09-25T03:00:00.000Z',
  cutoffAt: '2026-09-29T15:00:00.000Z',
  fase: 'OPEN' as const,
};

describe('ListaDeRodadas', () => {
  afterEach(cleanup);

  it('B3: cada rodada mostra o cutoff — o prazo das apostas —, não a abertura', () => {
    render(<ListaDeRodadas rodadas={[RODADA]} base="/interno/bet" />);
    expect(screen.getByText(/apostas até/i)).toBeTruthy();
    expect(document.querySelector(`time[datetime="${RODADA.cutoffAt}"]`)).not.toBeNull();
    expect(document.querySelector(`time[datetime="${RODADA.opensAt}"]`)).toBeNull();
    expect(screen.queryByText(/semana do reset/i)).toBeNull();
  });

  it('o link leva para a rodada na superfície certa', () => {
    render(<ListaDeRodadas rodadas={[RODADA]} base="/interno/bet-officer" />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/interno/bet-officer/r1');
    expect(screen.getByText(/apostas abertas/i)).toBeTruthy();
  });

  it('D-77: rodada cancelada aparece como Cancelada — nem encerrada, nem liquidada', () => {
    render(<ListaDeRodadas rodadas={[{ ...RODADA, fase: 'CANCELLED' }]} base="/interno/bet" />);
    expect(screen.getByText(/^cancelada$/i)).toBeTruthy();
    expect(screen.queryByText(/encerrada|liquidada|expirad/i)).toBeNull();
  });

  it('B1: lista vazia diz que está vazia', () => {
    render(<ListaDeRodadas rodadas={[]} base="/interno/bet-officer" />);
    expect(screen.getByText(/nenhuma rodada/i)).toBeTruthy();
  });
});
