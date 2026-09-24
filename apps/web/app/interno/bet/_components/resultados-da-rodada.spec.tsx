// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CLOSING } from './fixtures';
import { ResultadosDaRodada } from './resultados-da-rodada';

/** F1 — T-UI10: o Round Closing Report publicado (D-48, D-61). */

const grupo = (nome: string) => screen.getByRole('region', { name: nome });

describe('ResultadosDaRodada', () => {
  afterEach(cleanup);

  it('mercado com vencedor: quem venceu e quem ganhou quanto', () => {
    render(<ResultadosDaRodada closing={CLOSING} />);
    const dps = grupo('Top DPS · Boss Farm');
    expect(within(dps).getByText('Outropersonagem-Azralon')).toBeTruthy();
    expect(within(dps).getByText(/Apostadorum-Azralon/)).toBeTruthy();
    expect(within(dps).getByText(/2\.173/)).toBeTruthy();
  });

  it('sem vencedor: o motivo em português, e o pool redistribuído (D-61)', () => {
    render(<ResultadosDaRodada closing={CLOSING} />);
    const fd = grupo('First Death · Boss Farm');
    expect(within(fd).getByText(/o boss não morreu/i)).toBeTruthy();
    expect(within(fd).getByText(/redistribuído/i)).toBeTruthy();
  });

  it('Weekly: os bosses de progressão mortos na semana (D-54)', () => {
    render(<ResultadosDaRodada closing={CLOSING} />);
    expect(within(grupo('Weekly Progression')).getByText('Boss Novo')).toBeTruthy();
  });

  it('anulado mostra o motivo e a restituição', () => {
    const anulado = {
      ...CLOSING,
      conteudo: {
        ...CLOSING.conteudo,
        mercados: [
          {
            ...CLOSING.conteudo.mercados[0]!,
            desfecho: 'anulado' as const,
            motivo: 'mercado_cancelado',
            vencedores: [],
            ganhos: [],
          },
        ],
      },
    };
    render(<ResultadosDaRodada closing={anulado} />);
    expect(within(grupo('Top DPS · Boss Farm')).getByText(/anulado/i)).toBeTruthy();
    expect(within(grupo('Top DPS · Boss Farm')).getByText(/restitu/i)).toBeTruthy();
  });

  it('o total devido por membro e o resumo do Guild Bank, com a versão publicada', () => {
    render(<ResultadosDaRodada closing={CLOSING} />);
    expect(screen.getByText(/3\.073/)).toBeTruthy();
    expect(screen.getByText(/330/)).toBeTruthy();
    expect(screen.getByText(/versão 1/i)).toBeTruthy();
  });
});

/** Achados da validação no navegador (titan-bet-test-design.md §39). */
describe('ResultadosDaRodada — achados do navegador', () => {
  afterEach(cleanup);

  const semNinguem = {
    ...CLOSING,
    conteudo: {
      ...CLOSING.conteudo,
      mercados: CLOSING.conteudo.mercados.map((m) => ({
        ...m,
        desfecho: 'sem_vencedor' as const,
        motivo: 'sem_kill',
        vencedores: [],
        bossesVencedores: [],
        ganhos: [],
      })),
      totais: [],
    },
  };

  it('B11: sem vencedor em nenhum mercado, não diz que redistribuiu', () => {
    render(<ResultadosDaRodada closing={semNinguem} />);
    expect(screen.queryByText(/redistribu/i)).toBeNull();
    expect(screen.getByText(/nenhum mercado teve vencedor/i)).toBeTruthy();
  });

  it('B12: sem valor devido, a seção diz isso em vez de ficar vazia', () => {
    render(<ResultadosDaRodada closing={semNinguem} />);
    expect(screen.getByText(/ninguém tem valor a receber/i)).toBeTruthy();
  });
});
