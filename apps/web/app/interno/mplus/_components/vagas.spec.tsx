// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Vaga } from '@titan/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vagas } from './vagas';

const fetchMock = vi.fn();

const vagaDeOutro: Vaga = {
  id: 'vaga-de-outro',
  vagas: { tank: 1, healer: 0, dps: 0 },
  quando: new Date(Date.now() + 86_400_000).toISOString(),
  keyMin: 15,
  keyMax: 18,
  faltando: [],
  criadaPor: 'Outra#1234',
  criadaEm: new Date().toISOString(),
  entregue: true,
  podeApagar: false,
};

const minhaVaga: Vaga = { ...vagaDeOutro, id: 'minha-vaga', podeApagar: true };

function resposta(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Marca healer e deixa o resto no padrão. */
async function preencher() {
  await userEvent.click(screen.getByLabelText('Healer'));
  fireEvent.change(screen.getByLabelText('Quando'), { target: { value: proximaSemana() } });
}

function proximaSemana(): string {
  const data = new Date(Date.now() + 2 * 86_400_000);
  const local = new Date(data.getTime() - data.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

describe('Vagas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = fetchMock;
  });

  afterEach(cleanup);

  it('manda a vaga validada para a API do Nest, com o cookie de sessão', async () => {
    fetchMock.mockResolvedValue(resposta({ ...minhaVaga, id: 'nova' }));
    render(<Vagas inicial={[]} />);
    await preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Anunciar no Discord' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/internal/mplus/vagas');
    expect(init.credentials).toBe('include');

    const corpo = JSON.parse(String(init.body)) as { vagas: unknown; quando: string };
    expect(corpo.vagas).toEqual({ tank: 0, healer: 1, dps: 0 });
    // O contrato é UTC, sempre — o input fala no fuso do navegador.
    expect(corpo.quando).toMatch(/Z$/);
  });

  it('mostra o erro do keyMin, que antes reprovava em silêncio', async () => {
    // O bug: keyMin reprovava a validação, a mensagem não era renderizada em
    // lugar nenhum, e o botão parecia morto. Além do campo, a tela ganhou um
    // bloco que recolhe erro de campo sem lugar próprio, para não repetir.
    render(<Vagas inicial={[]} />);
    await preencher();
    fireEvent.change(screen.getByLabelText('Key de'), { target: { value: '1' } });
    await userEvent.click(screen.getByRole('button', { name: 'Anunciar no Discord' }));

    expect(await screen.findByText(/não existe key \+1/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aceita M0 e manda 0 para a API', async () => {
    fetchMock.mockResolvedValue(resposta({ ...minhaVaga, id: 'nova' }));
    render(<Vagas inicial={[]} />);
    await preencher();
    fireEvent.change(screen.getByLabelText('Key de'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('até'), { target: { value: '0' } });
    await userEvent.click(screen.getByRole('button', { name: 'Anunciar no Discord' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(String(init.body)) as { keyMin: number; keyMax: number };
    expect(corpo).toMatchObject({ keyMin: 0, keyMax: 0 });
  });

  it('não chama a API quando nenhuma role foi marcada', async () => {
    render(<Vagas inicial={[]} />);
    fireEvent.change(screen.getByLabelText('Quando'), { target: { value: proximaSemana() } });
    await userEvent.click(screen.getByRole('button', { name: 'Anunciar no Discord' }));

    expect(await screen.findByText(/pelo menos uma vaga/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserva o que foi digitado quando o Discord falha', async () => {
    fetchMock.mockResolvedValue(
      resposta({ message: 'A vaga foi salva, mas não foi anunciada.' }, 502),
    );
    render(<Vagas inicial={[]} />);
    await preencher();
    const observacao = screen.getByLabelText('Observação');
    fireEvent.change(observacao, { target: { value: 'Levo o meu tank.' } });

    await userEvent.click(screen.getByRole('button', { name: 'Anunciar no Discord' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'A vaga foi salva, mas não foi anunciada.',
    );
    expect((observacao as HTMLTextAreaElement).value).toBe('Levo o meu tank.');
    expect((screen.getByLabelText('Healer') as HTMLInputElement).checked).toBe(true);
  });

  it('só oferece apagar na vaga de quem está lendo', () => {
    render(<Vagas inicial={[minhaVaga, vagaDeOutro]} />);
    expect(screen.getAllByRole('button', { name: 'Apagar' })).toHaveLength(1);
  });

  it('diz que apagar não recolhe a mensagem do Discord', () => {
    render(<Vagas inicial={[minhaVaga]} />);
    expect(screen.getByText(/continua no canal do Discord/i)).toBeTruthy();
  });

  it('apaga pela API e tira da lista', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<Vagas inicial={[minhaVaga]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Apagar' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/internal/mplus/vagas/minha-vaga');
    expect(init.method).toBe('DELETE');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Apagar' })).toBeNull());
  });

  it('avisa quando uma vaga existe mas não foi anunciada', () => {
    render(<Vagas inicial={[{ ...minhaVaga, entregue: false }]} />);
    expect(screen.getByText(/não foi anunciada no Discord/i)).toBeTruthy();
  });
});
