// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeuSlip } from '@titan/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApostasDaRodada } from './apostas-da-rodada';
import { CARDAPIO, ODDS, RASCUNHO, resposta } from './fixtures';

/**
 * F1 — a superfície do membro em `/interno/bet` (titan-bet-test-design.md
 * §34.2). O fetch é falso; os contratos são os do shared.
 */

const fetchMock = vi.fn();
const API = 'http://localhost:3001/internal/titan-bet/rodadas/r1';

const grupo = (nome: string) => screen.getByRole('group', { name: nome });

function chamada(i: number) {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit | undefined];
  return {
    url,
    init: init ?? {},
    corpo: init?.body ? (JSON.parse(String(init.body)) as unknown) : null,
  };
}

describe('ApostasDaRodada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = fetchMock;
  });

  afterEach(cleanup);

  describe('T-UI02 — fora do snapshot: vê mercados e odds, sem apostar (D-53b)', () => {
    it('as opções e as odds aparecem; nenhum controle de aposta', () => {
      render(
        <ApostasDaRodada cardapio={{ ...CARDAPIO, podeApostar: false }} odds={ODDS} slip={null} />,
      );
      expect(within(grupo('Top DPS · Boss Farm')).getByText(/Meupersonagem/)).toBeTruthy();
      expect(within(grupo('Top DPS · Boss Farm')).getByText('2,50×')).toBeTruthy();
      expect(screen.queryAllByRole('radio')).toHaveLength(0);
      expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).toBeNull();
      expect(screen.getByText(/não está no snapshot de apostadores/i)).toBeTruthy();
    });
  });

  describe('T-UI03 — Weekly: um boss de progressão, cada um com a sua odd (D-54)', () => {
    it('as opções são os bosses de progressão, e a aposta leva o encounterId', async () => {
      fetchMock
        .mockResolvedValueOnce(resposta({ slipId: 's1' }))
        .mockResolvedValueOnce(resposta(RASCUNHO));
      render(<ApostasDaRodada cardapio={CARDAPIO} odds={ODDS} slip={null} />);

      const weekly = grupo('Weekly Progression');
      expect(within(weekly).getByRole('radio', { name: /Boss Novo/ })).toBeTruthy();
      expect(within(weekly).getByText('1,50×')).toBeTruthy();
      expect(within(weekly).getByRole('radio', { name: /Boss Final/ })).toBeTruthy();

      await userEvent.click(within(weekly).getByRole('radio', { name: /Boss Novo/ }));
      await userEvent.clear(within(weekly).getByLabelText('Stake (gold)'));
      await userEvent.type(within(weekly).getByLabelText('Stake (gold)'), '250');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(chamada(0).corpo).toEqual({
        apostas: [{ marketId: 'm-weekly', stake: 250, encounterId: 'e2' }],
      });
    });
  });

  describe('T-UI04 — Salvar manda o rascunho inteiro (D-27, D-28)', () => {
    it('PUT com o cookie, todas as apostas escolhidas, e relê o slip', async () => {
      fetchMock
        .mockResolvedValueOnce(resposta({ slipId: 's1' }))
        .mockResolvedValueOnce(resposta(RASCUNHO));
      render(<ApostasDaRodada cardapio={CARDAPIO} odds={ODDS} slip={null} />);

      await userEvent.click(
        within(grupo('Top DPS · Boss Farm')).getByRole('radio', { name: /Outropersonagem/ }),
      );
      await userEvent.click(
        within(grupo('Weekly Progression')).getByRole('radio', { name: /Boss Final/ }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const put = chamada(0);
      expect(put.url).toBe(`${API}/slip`);
      expect(put.init.method).toBe('PUT');
      expect(put.init.credentials).toBe('include');
      expect(put.corpo).toEqual({
        apostas: [
          { marketId: 'm-dps', stake: 200, targetCharacterId: 'c-outro' },
          { marketId: 'm-weekly', stake: 200, encounterId: 'e3' },
        ],
      });
      expect(chamada(1).url).toBe(`${API}/slip`);
      expect(await screen.findByText(/rascunho salvo/i)).toBeTruthy();
    });

    it('o rascunho salvo volta preenchido', () => {
      render(<ApostasDaRodada cardapio={CARDAPIO} odds={ODDS} slip={RASCUNHO} />);
      const dps = grupo('Top DPS · Boss Farm');
      expect(
        (within(dps).getByRole('radio', { name: /Outropersonagem/ }) as HTMLInputElement).checked,
      ).toBe(true);
      expect((within(dps).getByLabelText('Stake (gold)') as HTMLInputElement).value).toBe('300');
    });

    it('stake fora de 200–1000 é barrado antes da API, com a mensagem do contrato', async () => {
      render(<ApostasDaRodada cardapio={CARDAPIO} odds={ODDS} slip={RASCUNHO} />);
      const dps = grupo('Top DPS · Boss Farm');
      await userEvent.clear(within(dps).getByLabelText('Stake (gold)'));
      await userEvent.type(within(dps).getByLabelText('Stake (gold)'), '50');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await screen.findByRole('alert')).toBeTruthy();
    });

    it('422 aparece com o motivo do backend, sem tradução', async () => {
      fetchMock.mockResolvedValueOnce(
        resposta({ message: 'o alvo não é candidato deste mercado', statusCode: 422 }, 422),
      );
      render(<ApostasDaRodada cardapio={CARDAPIO} odds={ODDS} slip={RASCUNHO} />);
      await userEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
      expect(await screen.findByText('o alvo não é candidato deste mercado')).toBeTruthy();
    });
  });

  describe('T-UI05 — First Death não oferece personagem do próprio apostador (D-56)', () => {
    it('o próprio personagem fica fora das opções; os outros, com a odd', () => {
      render(<ApostasDaRodada cardapio={CARDAPIO} odds={ODDS} slip={null} />);
      const fd = grupo('First Death · Boss Farm');
      expect(within(fd).queryByRole('radio', { name: /Meupersonagem/ })).toBeNull();
      expect(within(fd).getByRole('radio', { name: /Outropersonagem/ })).toBeTruthy();
      expect(within(fd).getByText('1,80×')).toBeTruthy();
      // Em Top DPS, apostar em si mesmo é permitido (D-09).
      expect(
        within(grupo('Top DPS · Boss Farm')).getByRole('radio', { name: /Meupersonagem/ }),
      ).toBeTruthy();
    });

    it('se o backend recusar mesmo assim, o motivo aparece', async () => {
      fetchMock.mockResolvedValueOnce(
        resposta(
          { message: 'First Death em personagem do próprio apostador não é permitido' },
          422,
        ),
      );
      render(<ApostasDaRodada cardapio={CARDAPIO} odds={ODDS} slip={RASCUNHO} />);
      await userEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
      expect(await screen.findByText(/próprio apostador não é permitido/)).toBeTruthy();
    });
  });

  describe('T-UI06 — Submeter: depositante por nome + realm, sem região (D-55)', () => {
    it('POST com o depositante; mostra o total a depositar', async () => {
      const submetido: MeuSlip = {
        ...RASCUNHO,
        status: 'aguardando_deposito',
        depositCharacter: { name: 'Qualquer', realm: 'Azralon' },
        expectedTotal: 300,
      };
      fetchMock
        .mockResolvedValueOnce(resposta({ total: 300 }))
        .mockResolvedValueOnce(resposta(submetido));
      render(<ApostasDaRodada cardapio={CARDAPIO} odds={ODDS} slip={RASCUNHO} />);

      expect(screen.queryByLabelText(/região/i)).toBeNull();
      await userEvent.type(screen.getByLabelText('Personagem que deposita'), 'Qualquer');
      await userEvent.type(screen.getByLabelText('Realm'), 'Azralon');
      await userEvent.click(screen.getByRole('button', { name: 'Submeter pagamento' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const post = chamada(0);
      expect(post.url).toBe(`${API}/slip/submeter`);
      expect(post.init.method).toBe('POST');
      expect(post.corpo).toEqual({ depositCharacter: { name: 'Qualquer', realm: 'Azralon' } });
      expect(await screen.findByText(/deposite 300 gold/i)).toBeTruthy();
    });

    it('sem personagem ou realm, nada vai para a API', async () => {
      render(<ApostasDaRodada cardapio={CARDAPIO} odds={ODDS} slip={RASCUNHO} />);
      await userEvent.click(screen.getByRole('button', { name: 'Submeter pagamento' }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await screen.findByRole('alert')).toBeTruthy();
    });

    it('Submeter só existe com rascunho salvo', () => {
      render(<ApostasDaRodada cardapio={CARDAPIO} odds={ODDS} slip={null} />);
      expect(screen.queryByRole('button', { name: 'Submeter pagamento' })).toBeNull();
    });
  });

  describe('T-UI07 — slip submetido é só leitura (D-27, D-34)', () => {
    it('aguardando depósito: estado, depositante como informado e total; sem edição', () => {
      render(
        <ApostasDaRodada
          cardapio={CARDAPIO}
          odds={ODDS}
          slip={{
            ...RASCUNHO,
            status: 'aguardando_deposito',
            depositCharacter: { name: 'Qualquer', realm: 'Azralon' },
            expectedTotal: 300,
          }}
        />,
      );
      expect(screen.getByText(/aguardando depósito/i)).toBeTruthy();
      expect(screen.getByText(/Qualquer-Azralon/)).toBeTruthy();
      expect(screen.getByText(/deposite 300 gold/i)).toBeTruthy();
      expect(screen.queryAllByRole('radio')).toHaveLength(0);
      expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).toBeNull();
      // A escolha continua visível para o dono, marcada na opção.
      expect(within(grupo('Top DPS · Boss Farm')).getByText(/sua aposta · 300 gold/)).toBeTruthy();
    });

    it('recusado: mostra o motivo e deixa começar outro slip', async () => {
      render(
        <ApostasDaRodada
          cardapio={CARDAPIO}
          odds={ODDS}
          slip={{
            ...RASCUNHO,
            status: 'recusado',
            depositCharacter: { name: 'Qualquer', realm: 'Azralon' },
            expectedTotal: 300,
            rejectionReason: 'depósito de 200, não de 300',
          }}
        />,
      );
      expect(screen.getByText('depósito de 200, não de 300')).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: 'Começar outro slip' }));
      expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeTruthy();
      expect(
        (
          within(grupo('Top DPS · Boss Farm')).getByRole('radio', {
            name: /Outropersonagem/,
          }) as HTMLInputElement
        ).checked,
      ).toBe(false);
    });
  });

  describe('T-UI08 — depois do cutoff não há edição (R-06)', () => {
    it('fase fechada: sem controles, e o horário do cutoff na tela', () => {
      render(
        <ApostasDaRodada
          cardapio={{ ...CARDAPIO, fase: 'BETTING_CLOSED', podeApostar: false }}
          odds={ODDS}
          slip={RASCUNHO}
        />,
      );
      expect(screen.queryAllByRole('radio')).toHaveLength(0);
      expect(screen.queryByRole('button', { name: /Salvar|Submeter/ })).toBeNull();
      expect(screen.getByText(/apostas encerradas/i)).toBeTruthy();
      expect(document.querySelector(`time[datetime="${CARDAPIO.cutoffAt}"]`)).not.toBeNull();
    });

    it('aberta: o cutoff aparece como prazo', () => {
      render(<ApostasDaRodada cardapio={CARDAPIO} odds={ODDS} slip={null} />);
      expect(screen.getByText(/apostas até/i)).toBeTruthy();
    });
  });

  describe('T-UI09 — odds: "—" sem aposta, e projeção, não promessa (§16.10)', () => {
    it('multiplicador nulo é "—"; o aviso de projeção aparece', () => {
      render(<ApostasDaRodada cardapio={CARDAPIO} odds={ODDS} slip={null} />);
      const dps = grupo('Top DPS · Boss Farm');
      expect(within(dps).getByText('—')).toBeTruthy();
      expect(screen.getByText(/projeção/i)).toBeTruthy();
    });

    it('odds indisponíveis: a tela avisa em vez de inventar opções', () => {
      render(<ApostasDaRodada cardapio={CARDAPIO} odds={null} slip={null} />);
      expect(screen.getByText(/odds indisponíveis/i)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).toBeNull();
    });
  });

  describe('T-UI11 — nenhuma aposta de outra pessoa na tela (D-36)', () => {
    it('resposta do slip com campo a mais é recusada pelo contrato estrito, não renderizada', async () => {
      fetchMock
        .mockResolvedValueOnce(resposta({ slipId: 's1' }))
        .mockResolvedValueOnce(
          resposta({ ...RASCUNHO, apostasDeOutros: [{ quem: 'Vazado', stake: 999 }] }),
        );
      render(<ApostasDaRodada cardapio={CARDAPIO} odds={ODDS} slip={RASCUNHO} />);
      await userEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));

      expect(await screen.findByText(/resposta inesperada/i)).toBeTruthy();
      expect(screen.queryByText(/Vazado/)).toBeNull();
      expect(screen.queryByText(/999/)).toBeNull();
    });
  });
});
