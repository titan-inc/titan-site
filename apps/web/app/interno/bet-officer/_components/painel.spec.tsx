// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionUser } from '@titan/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destinoDoPainel } from './acesso';
import { Auditoria } from './auditoria';
import { CriarRodada } from './criar-rodada';
import { Depositos } from './depositos';
import {
  AUDITORIA,
  CATALOGO,
  CATALOGO_COM_TIER,
  DEPOSITOS,
  OFFICER_BT,
  PREPARACAO,
  RESULTADOS,
  SALDOS,
  SLIPS,
  SLIP_VISTO,
  resposta,
} from './fixtures';
import { Preparacao } from './preparacao';
import { PublicarClosing } from './publicar-closing';
import { Resultados } from './resultados';
import { Saldos } from './saldos';
import { SlipsSubmetidos } from './slips-submetidos';

/**
 * F2 — o Officer Panel (titan-bet-test-design.md §34.3). O fetch é falso; o
 * `OfficerGuard` do Nest continua sendo a regra (Regra 5).
 */

const fetchMock = vi.fn();
const refresh = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push }) }));

const OFFICER_API = 'http://localhost:3001/internal/titan-bet/officer';

function chamada(i: number) {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit | undefined];
  return {
    url,
    metodo: init?.method ?? 'GET',
    credenciais: init?.credentials,
    corpo: init?.body ? (JSON.parse(String(init.body)) as unknown) : null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = fetchMock;
});

afterEach(cleanup);

describe('T-UI20 — o painel é de officer; a regra é o OfficerGuard (D-36)', () => {
  it('sem sessão → login; sem ser officer → /interno; officer fica', () => {
    expect(destinoDoPainel(null)).toBe('/?erro=sessao');
    expect(
      destinoDoPainel({
        membership: 'member',
        hasInternalAccess: true,
        isOfficer: false,
      } as SessionUser),
    ).toBe('/interno');
    expect(
      destinoDoPainel({
        membership: 'member',
        hasInternalAccess: true,
        isOfficer: true,
      } as SessionUser),
    ).toBeNull();
  });
});

describe('T-UI21 — criar a rodada da semana (D-45)', () => {
  it('cria e abre a rodada nova', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ roundId: 'r9' }, 201));
    render(<CriarRodada />);
    await userEvent.click(screen.getByRole('button', { name: 'Criar rodada da semana' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/interno/bet-officer/r9'));
    expect(chamada(0)).toMatchObject({ url: `${OFFICER_API}/rodadas`, metodo: 'POST' });
  });

  it('recusa do backend (já existe) aparece como veio', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ message: 'a rodada desta semana já existe' }, 409));
    render(<CriarRodada />);
    await userEvent.click(screen.getByRole('button', { name: 'Criar rodada da semana' }));
    expect(await screen.findByText('a rodada desta semana já existe')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('T-UI21 — preparar a semana (D-45, D-54)', () => {
  it('encounter do catálogo, farm/progressão e mercados; salvar manda a semana inteira', async () => {
    fetchMock.mockResolvedValueOnce(resposta(PREPARACAO));
    render(<Preparacao preparacao={PREPARACAO} catalogo={CATALOGO} editavel />);

    const farm = screen.getByRole('group', { name: 'Boss Farm' });
    await userEvent.click(within(farm).getByRole('checkbox', { name: 'Incluir na semana' }));
    await userEvent.click(within(farm).getByRole('checkbox', { name: 'Top DPS' }));

    const novo = screen.getByRole('group', { name: 'Boss Novo' });
    await userEvent.click(within(novo).getByRole('checkbox', { name: 'Incluir na semana' }));
    await userEvent.selectOptions(within(novo).getByLabelText('Track'), 'progressao');
    await userEvent.click(within(novo).getByRole('checkbox', { name: 'First Death' }));

    await userEvent.click(screen.getByRole('checkbox', { name: /Weekly Progression/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar preparação' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const put = chamada(0);
    expect(put.url).toBe(`${OFFICER_API}/rodadas/r1/preparacao`);
    expect(put.metodo).toBe('PUT');
    expect(put.credenciais).toBe('include');
    expect(put.corpo).toEqual({
      weekly: true,
      encounters: [
        { encounterId: 101, track: 'farm', mercados: ['top_dps'] },
        { encounterId: 102, track: 'progressao', mercados: ['first_death'] },
      ],
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('progressão só oferece First Death (D-29); a Weekly não marca boss (D-54)', async () => {
    render(<Preparacao preparacao={PREPARACAO} catalogo={CATALOGO} editavel />);
    const novo = screen.getByRole('group', { name: 'Boss Novo' });
    await userEvent.click(within(novo).getByRole('checkbox', { name: 'Incluir na semana' }));
    await userEvent.selectOptions(within(novo).getByLabelText('Track'), 'progressao');
    expect(within(novo).queryByRole('checkbox', { name: 'Top DPS' })).toBeNull();
    expect(within(novo).getByRole('checkbox', { name: 'First Death' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /weekly.*boss/i })).toBeNull();
  });

  it('a configuração salva volta marcada; depois do Ready, só leitura', () => {
    const salva = {
      ...PREPARACAO,
      readyAt: '2026-09-23T12:00:00.000Z',
      weekly: { marketId: 'mw' },
      encounters: [
        {
          roundEncounterId: 'e1',
          encounterId: 101,
          encounterName: 'Boss Farm',
          zoneName: 'Raid de Teste',
          track: 'farm' as const,
          mercados: [{ marketId: 'm1', kind: 'top_dps' as const }],
        },
      ],
    };
    render(<Preparacao preparacao={salva} catalogo={null} editavel={false} />);
    expect(screen.queryByRole('button', { name: 'Salvar preparação' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dar Ready' })).toBeNull();
    expect(screen.getByText(/Boss Farm/)).toBeTruthy();
    expect(screen.getByText(/Top DPS/)).toBeTruthy();
  });
});

describe('T-UI22 — Ready com as recusas do backend (D-31)', () => {
  it('409 aparece com o motivo, sem tradução', async () => {
    fetchMock.mockResolvedValueOnce(
      resposta({ message: 'a Weekly Progression não tem nenhum boss de progressão' }, 409),
    );
    render(<Preparacao preparacao={PREPARACAO} catalogo={CATALOGO} editavel />);
    await userEvent.click(screen.getByRole('button', { name: 'Dar Ready' }));
    expect(
      await screen.findByText('a Weekly Progression não tem nenhum boss de progressão'),
    ).toBeTruthy();
    expect(chamada(0)).toMatchObject({ url: `${OFFICER_API}/rodadas/r1/ready`, metodo: 'POST' });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('T-UI23 — depósitos pendentes (D-34, D-58)', () => {
  it('confirmar chama a API e recarrega', async () => {
    fetchMock.mockResolvedValueOnce(resposta(null, 204));
    render(<Depositos depositos={DEPOSITOS} officerBattletag={OFFICER_BT} />);
    const linha = screen.getByRole('listitem', { name: /Membro#1234/ });
    await userEvent.click(within(linha).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(chamada(0)).toMatchObject({
      url: `${OFFICER_API}/slips/s-outro/confirmar`,
      metodo: 'POST',
    });
  });

  it('recusar exige motivo: sem ele, nada vai para a API', async () => {
    render(<Depositos depositos={DEPOSITOS} officerBattletag={OFFICER_BT} />);
    const linha = screen.getByRole('listitem', { name: /Membro#1234/ });
    await userEvent.click(within(linha).getByRole('button', { name: 'Recusar' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('recusar com motivo manda o motivo', async () => {
    fetchMock.mockResolvedValueOnce(resposta(null, 204));
    render(<Depositos depositos={DEPOSITOS} officerBattletag={OFFICER_BT} />);
    const linha = screen.getByRole('listitem', { name: /Membro#1234/ });
    await userEvent.type(within(linha).getByLabelText('Motivo da recusa'), 'valor diferente');
    await userEvent.click(within(linha).getByRole('button', { name: 'Recusar' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(chamada(0)).toMatchObject({
      url: `${OFFICER_API}/slips/s-outro/recusar`,
      corpo: { motivo: 'valor diferente' },
    });
  });

  it('o officer confirma o próprio depósito (D-58)', () => {
    render(<Depositos depositos={DEPOSITOS} officerBattletag={OFFICER_BT} />);
    const meu = screen.getByRole('listitem', { name: new RegExp(OFFICER_BT) });
    expect(within(meu).getByText(/seu/i)).toBeTruthy();
    expect(within(meu).getByRole('button', { name: 'Confirmar' })).toBeTruthy();
  });
});

describe('T-UI24 — "ver slip": ação explícita, só leitura (D-57)', () => {
  it('a lista não abre slip nenhum sozinha', () => {
    render(<SlipsSubmetidos slips={SLIPS.slips} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Membro#1234/)).toBeTruthy();
  });

  it('abrir busca o slip, avisa que o acesso é registrado e mostra as apostas', async () => {
    fetchMock.mockResolvedValueOnce(resposta(SLIP_VISTO));
    render(<SlipsSubmetidos slips={SLIPS.slips} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver slip' }));

    expect(await screen.findByText(/Alvoescolhido-Azralon/)).toBeTruthy();
    expect(screen.getByText(/Boss Novo/)).toBeTruthy();
    expect(screen.getByText(/acesso fica registrado/i)).toBeTruthy();
    expect(chamada(0)).toMatchObject({ url: `${OFFICER_API}/slips/s1`, metodo: 'GET' });
    // Só leitura: nenhum botão que altere o slip.
    expect(screen.queryByRole('button', { name: /Confirmar|Recusar|Salvar/ })).toBeNull();
  });

  it('rascunho → 409 com o motivo', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ message: 'o slip ainda não foi submetido' }, 409));
    render(<SlipsSubmetidos slips={SLIPS.slips} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver slip' }));
    expect(await screen.findByText('o slip ainda não foi submetido')).toBeTruthy();
  });
});

describe('T-UI25 — Auditar e "não houve raid oficial" (D-60, D-63)', () => {
  it('fontes por sessão com todos os `titanbet*`; ausente pede a declaração', () => {
    render(<Auditoria roundId="r1" auditoria={AUDITORIA} podeAuditar />);
    const terca = screen.getByRole('region', { name: /Terça/ });
    expect(within(terca).getByText(/AbC123/)).toBeTruthy();
    expect(within(terca).getByText(/XyZ789/)).toBeTruthy();
    const quinta = screen.getByRole('region', { name: /Quinta/ });
    expect(within(quinta).getByText(/nenhum report/i)).toBeTruthy();
    expect(
      within(quinta).getByRole('button', { name: 'Declarar que não houve raid oficial' }),
    ).toBeTruthy();
  });

  it('a declaração exige motivo, e vai para a sessão certa', async () => {
    fetchMock.mockResolvedValueOnce(resposta(null, 204));
    render(<Auditoria roundId="r1" auditoria={AUDITORIA} podeAuditar />);
    const quinta = screen.getByRole('region', { name: /Quinta/ });
    const declarar = within(quinta).getByRole('button', {
      name: 'Declarar que não houve raid oficial',
    });
    await userEvent.click(declarar);
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.type(within(quinta).getByLabelText('Motivo'), 'raid cancelada');
    await userEvent.click(declarar);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(chamada(0)).toMatchObject({
      url: `${OFFICER_API}/auditorias/a1/fontes/quinta/sem-raid`,
      metodo: 'POST',
      corpo: { motivo: 'raid cancelada' },
    });
  });

  it('Auditar abre uma tentativa e recarrega', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ auditId: 'a2' }, 201));
    render(<Auditoria roundId="r1" auditoria={null} podeAuditar />);
    await userEvent.click(screen.getByRole('button', { name: 'Auditar' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(chamada(0)).toMatchObject({ url: `${OFFICER_API}/rodadas/r1/auditar`, metodo: 'POST' });
  });
});

describe('T-UI26 — resultados e liquidação (D-61)', () => {
  const bosses = { e2: 'Boss Novo' };

  it('cada mercado com desfecho, motivo e pools; Weekly com os nomes dos bosses', () => {
    render(<Resultados resultados={RESULTADOS} bosses={bosses} podeCalcular={false} />);
    expect(screen.getByText(/Alvoescolhido-Azralon/)).toBeTruthy();
    expect(screen.getByText(/o boss não morreu/i)).toBeTruthy();
    expect(screen.getByText('Boss Novo')).toBeTruthy();
  });

  it('liquidar pede confirmação explícita antes de chamar a API', async () => {
    fetchMock.mockResolvedValueOnce(resposta(null, 204));
    render(<Resultados resultados={RESULTADOS} bosses={bosses} podeCalcular={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e liquidar' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/mexe em dinheiro/i)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Sim, liquidar' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(chamada(0)).toMatchObject({
      url: `${OFFICER_API}/auditorias/a1/confirmar`,
      metodo: 'POST',
    });
  });

  it('confirmada não oferece liquidar de novo', () => {
    render(
      <Resultados
        resultados={{ ...RESULTADOS, status: 'confirmada' }}
        bosses={bosses}
        podeCalcular={false}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Confirmar e liquidar' })).toBeNull();
  });

  it('calcular, quando a auditoria está pronta', async () => {
    fetchMock.mockResolvedValueOnce(resposta(null, 204));
    render(<Resultados resultados={null} auditId="a1" bosses={bosses} podeCalcular />);
    await userEvent.click(screen.getByRole('button', { name: 'Calcular resultados' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(chamada(0)).toMatchObject({ url: `${OFFICER_API}/auditorias/a1/calcular` });
  });
});

describe('T-UI27 — saldos, pagar e ajustar (D-11, D-44)', () => {
  it('pagar lança o saldo e recarrega', async () => {
    fetchMock.mockResolvedValueOnce(resposta(null, 204));
    render(<Saldos saldos={SALDOS.saldos} />);
    await userEvent.click(screen.getByRole('button', { name: /Pagar 2\.173 gold/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(chamada(0)).toMatchObject({ url: `${OFFICER_API}/slips/s1/pagar`, metodo: 'POST' });
  });

  it('ajustar: escolhe o lançamento corrigido; manda valor com sinal e motivo', async () => {
    fetchMock
      .mockResolvedValueOnce(
        resposta({
          lancamentos: [
            {
              entryId: '41',
              kind: 'deposito_validado',
              amount: 500,
              reason: null,
              actorBattletag: OFFICER_BT,
              createdAt: '2026-09-23T17:00:00.000Z',
            },
            {
              entryId: '42',
              kind: 'premio',
              amount: 2173,
              reason: null,
              actorBattletag: null,
              createdAt: '2026-10-01T15:00:00.000Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(resposta(null, 204));
    render(<Saldos saldos={SALDOS.saldos} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ajustar' }));

    await userEvent.selectOptions(await screen.findByLabelText('Lançamento corrigido'), '42');
    await userEvent.type(screen.getByLabelText('Valor (gold, com sinal)'), '-100');
    await userEvent.type(screen.getByLabelText('Motivo do ajuste'), 'parse conferido');
    await userEvent.click(screen.getByRole('button', { name: 'Lançar ajuste' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(chamada(0).url).toBe(`${OFFICER_API}/slips/s1/lancamentos`);
    expect(chamada(1)).toMatchObject({
      url: `${OFFICER_API}/slips/s1/ajustes`,
      metodo: 'POST',
      corpo: { amount: -100, reason: 'parse conferido', correctsEntryId: '42' },
    });
  });

  it('ajuste de zero é barrado antes da API', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ lancamentos: [] }));
    render(<Saldos saldos={SALDOS.saldos} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ajustar' }));
    await userEvent.type(await screen.findByLabelText('Valor (gold, com sinal)'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Lançar ajuste' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('T-UI28 — publicar o Closing Report (D-48)', () => {
  it('publica e mostra a versão', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ version: 2 }, 201));
    render(<PublicarClosing roundId="r1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Publicar Closing Report' }));
    expect(await screen.findByText(/versão 2 publicada/i)).toBeTruthy();
    expect(chamada(0)).toMatchObject({ url: `${OFFICER_API}/rodadas/r1/closing`, metodo: 'POST' });
  });

  it('recusa do backend aparece como veio', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ message: 'a auditoria não está confirmada' }, 409));
    render(<PublicarClosing roundId="r1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Publicar Closing Report' }));
    expect(await screen.findByText('a auditoria não está confirmada')).toBeTruthy();
  });
});

/** Achados da validação no navegador (titan-bet-test-design.md §39). */
describe('achados do navegador — Officer Panel', () => {
  it('B7: o texto da sessão ausente não mostra crase de markdown', () => {
    render(<Auditoria roundId="r1" auditoria={AUDITORIA} podeAuditar />);
    const quinta = screen.getByRole('region', { name: /Quinta/ });
    expect(within(quinta).getByText(/nenhum report titanbet\*/i)).toBeTruthy();
    expect(quinta.textContent).not.toContain('`');
  });

  it('B8: cada resultado diz de que boss é — dois First Death não se confundem', () => {
    render(
      <Resultados
        resultados={RESULTADOS}
        bosses={{ e2: 'Boss Novo' }}
        encounters={{ m1: 'Boss Farm', m3: 'Boss Farm' }}
        podeCalcular={false}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Top DPS · Boss Farm' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'First Death · Boss Farm' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Weekly Progression' })).toBeTruthy();
  });

  it('B6 e B5: o lançamento aparece pelo nome, e o ajuste lançado fecha o formulário', async () => {
    fetchMock
      .mockResolvedValueOnce(
        resposta({
          lancamentos: [
            {
              entryId: '41',
              kind: 'deposito_validado',
              amount: 500,
              reason: null,
              actorBattletag: OFFICER_BT,
              createdAt: '2026-09-23T17:00:00.000Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(resposta(null, 204));
    render(<Saldos saldos={SALDOS.saldos} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ajustar' }));

    const lista = await screen.findByLabelText('Lançamento corrigido');
    expect(lista.textContent).toContain('Depósito validado');
    expect(lista.textContent).not.toContain('deposito_validado');

    await userEvent.type(screen.getByLabelText('Valor (gold, com sinal)'), '50');
    await userEvent.type(screen.getByLabelText('Motivo do ajuste'), 'conferido');
    await userEvent.click(screen.getByRole('button', { name: 'Lançar ajuste' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Lançar ajuste' })).toBeNull();
  });
});

/**
 * B2 (decisão de 24/09/2026, titan-bet-test-design.md §41): a preparação mostra
 * por padrão só o conteúdo atual da guilda — a zone da atividade de raid real
 * mais recente —, com "Mostrar todas" como ação secundária.
 */
describe('B2 — preparação com o conteúdo atual', () => {
  const zonasNaTela = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

  it('mostra por padrão só a zone atual', () => {
    render(<Preparacao preparacao={PREPARACAO} catalogo={CATALOGO_COM_TIER} editavel />);
    expect(zonasNaTela()).toEqual(['Tier Atual']);
    expect(screen.queryByRole('group', { name: 'Boss Antigo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mostrar todas' })).toBeTruthy();
  });

  it('"Mostrar todas" dá acesso aos demais conteúdos, e dá para voltar', async () => {
    render(<Preparacao preparacao={PREPARACAO} catalogo={CATALOGO_COM_TIER} editavel />);
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar todas' }));
    expect(zonasNaTela()).toEqual(['Tier Anterior', 'Tier Atual', 'Tier Atual (Beta)']);
    expect(screen.getByRole('group', { name: 'Boss Antigo' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar só o conteúdo atual' }));
    expect(zonasNaTela()).toEqual(['Tier Atual']);
  });

  it('sem conteúdo atual determinado: o catálogo completo e o aviso', () => {
    render(<Preparacao preparacao={PREPARACAO} catalogo={CATALOGO} editavel />);
    expect(screen.getByText(/conteúdo atual ainda não pôde ser determinado/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mostrar todas' })).toBeNull();
  });

  it('encounter já escolhido fora do conteúdo atual continua visível e é salvo', async () => {
    fetchMock.mockResolvedValueOnce(resposta(PREPARACAO));
    const comAntigo = {
      ...PREPARACAO,
      encounters: [
        {
          roundEncounterId: 'e-antigo',
          encounterId: 3176,
          encounterName: 'Boss Antigo',
          zoneName: 'Tier Anterior',
          track: 'farm' as const,
          mercados: [{ marketId: 'm-antigo', kind: 'top_dps' as const }],
        },
      ],
    };
    render(<Preparacao preparacao={comAntigo} catalogo={CATALOGO_COM_TIER} editavel />);
    expect(screen.getByRole('group', { name: 'Boss Antigo' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Salvar preparação' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(chamada(0).corpo).toMatchObject({
      encounters: [{ encounterId: 3176, track: 'farm', mercados: ['top_dps'] }],
    });
  });
});
