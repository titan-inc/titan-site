// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CARDAPIO, ODDS } from './fixtures';
import { OddsEmJogo } from './odds-em-jogo';

/** D-80 — a seção de odds em jogo na home do Titan Bet. */

describe('OddsEmJogo', () => {
  afterEach(cleanup);

  it('T-O05: um grupo por mercado com valor, cada opção com a sua odd, da maior para a menor', () => {
    render(<OddsEmJogo cardapio={CARDAPIO} odds={ODDS} />);

    const fd = screen.getByRole('group', { name: 'First Death · Boss Farm' });
    const linhas = within(fd).getAllByRole('listitem');
    expect(linhas).toHaveLength(2);
    expect(linhas[0]!.textContent).toMatch(/Meupersonagem.*3,00×/);
    expect(linhas[1]!.textContent).toMatch(/Outropersonagem.*1,80×/);

    // Opção sem aposta não aparece (não há "—" nesta tela).
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.queryByText(/Curandeiro/)).toBeNull();
    expect(screen.queryByText(/Boss Final/)).toBeNull();
    expect(screen.getByRole('group', { name: 'Weekly Progression' })).toBeTruthy();
  });

  it('T-O05: linka a página da rodada', () => {
    render(<OddsEmJogo cardapio={CARDAPIO} odds={ODDS} />);
    const link = screen.getByRole('link', { name: /ver a rodada/i });
    expect(link.getAttribute('href')).toBe('/interno/bet/r1');
  });

  it('explica que a odd é projeção e só conta apostas confirmadas', () => {
    render(<OddsEmJogo cardapio={CARDAPIO} odds={ODDS} />);
    expect(screen.getByText(/apostas confirmadas/i)).toBeTruthy();
    expect(screen.getByText(/não é promessa/i)).toBeTruthy();
  });

  it('T-O06: sem nenhuma odd com valor, diz que está vazio em vez de sumir', () => {
    render(
      <OddsEmJogo
        cardapio={CARDAPIO}
        odds={{
          roundId: 'r1',
          mercados: [
            { marketId: 'm-dps', opcoes: [{ characterId: 'c-meu', multiplicador: null }] },
          ],
        }}
      />,
    );
    expect(screen.getByText(/ainda não há apostas confirmadas/i)).toBeTruthy();
    expect(screen.queryAllByRole('group')).toHaveLength(0);
  });
});
