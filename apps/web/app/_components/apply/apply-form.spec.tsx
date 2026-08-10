// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplyForm } from './apply-form';

const fetchMock = vi.fn();

function preencher() {
  fireEvent.change(screen.getByLabelText(/Nome \/ realm/), {
    target: { value: 'Thrall — Azralon' },
  });
  fireEvent.change(screen.getByLabelText(/Role \/ spec/), {
    target: { value: 'Tank / Protection Warrior' },
  });
  fireEvent.change(screen.getByLabelText(/Contato/), {
    target: { value: 'Discord: thrall.azeroth' },
  });
  fireEvent.change(screen.getByLabelText(/Informações adicionais/), {
    target: { value: 'Disponível de terça a quinta.' },
  });
}

describe('ApplyForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = fetchMock;
  });

  afterEach(cleanup);

  it('envia o resultado validado exatamente uma vez, sem credentials', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ delivered: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    render(<ApplyForm />);
    preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar candidatura' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/applications');
    expect(init).not.toHaveProperty('credentials');
    expect(JSON.parse(String(init.body))).toEqual({
      characterRealm: 'Thrall — Azralon',
      roleSpec: 'Tank / Protection Warrior',
      contact: 'Discord: thrall.azeroth',
      additionalInfo: 'Disponível de terça a quinta.',
    });
  });

  it('mapeia erros 400 para o campo e move o foco', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'Corpo do request inválido',
          issues: [{ path: 'contact', message: 'Contato recusado' }],
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    render(<ApplyForm />);
    preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar candidatura' }));

    expect((await screen.findAllByText('Contato recusado')).length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(screen.getByLabelText(/Contato/));
  });

  it('mostra mensagem específica para 429', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
    render(<ApplyForm />);
    preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar candidatura' }));
    expect(await screen.findByText(/Muitos envios/)).toBeTruthy();
  });

  it.each([502, 503])('preserva valores quando a API responde %s', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    render(<ApplyForm />);
    preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar candidatura' }));

    expect(await screen.findByText(/não chegou/)).toBeTruthy();
    expect((screen.getByLabelText(/Informações adicionais/) as HTMLTextAreaElement).value).toBe(
      'Disponível de terça a quinta.',
    );
  });

  it('substitui o formulário e foca a confirmação no sucesso', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ delivered: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    render(<ApplyForm />);
    preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar candidatura' }));

    const confirmation = await screen.findByRole('status');
    await waitFor(() => expect(document.activeElement).toBe(confirmation));
    expect(screen.queryByRole('button', { name: 'Registrar candidatura' })).toBeNull();
  });

  it('ignora segundo submit enquanto o primeiro está pendente', async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((done) => (resolve = done)));
    render(<ApplyForm />);
    preencher();
    const form = screen.getByRole('button', { name: 'Registrar candidatura' }).closest('form');
    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    fireEvent.submit(form!);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve(
      new Response(JSON.stringify({ delivered: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await screen.findByRole('status');
  });
});
