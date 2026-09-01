import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from './proxy';

/**
 * O proxy é UX, não segurança (Regra 5) — quem autoriza é o guard no Nest.
 *
 * O que ele precisa acertar é não perder o caminho pretendido: a Regra 7 manda
 * todo post no Discord linkar fundo, então o link que a pessoa clica sem sessão
 * é exatamente o que ela quer de volta depois de entrar.
 */
function pedir(caminho: string, comCookie = false) {
  const req = new NextRequest(new URL(caminho, 'https://titaninc.com.br'));
  if (comCookie) req.cookies.set('titan_session', 'qualquer-coisa');
  return proxy(req);
}

const destino = (res: Response) => new URL(res.headers.get('location') ?? '');

describe('proxy de /interno', () => {
  it('sem cookie, manda para a home com o motivo', () => {
    const url = destino(pedir('/interno'));

    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('erro')).toBe('sessao');
  });

  it('sem cookie, o caminho pretendido viaja junto', () => {
    const url = destino(pedir('/interno/loot/abc123'));

    expect(url.searchParams.get('de')).toBe('/interno/loot/abc123');
  });

  it('a querystring do link original sobrevive', () => {
    const url = destino(pedir('/interno/presenca?noite=2026-08-28'));

    expect(url.searchParams.get('de')).toBe('/interno/presenca?noite=2026-08-28');
  });

  // Só a presença do cookie, nunca o valor — validar é trabalho do Nest, e um
  // cookie inventado passa por aqui de propósito.
  it('com cookie, deixa passar', () => {
    expect(pedir('/interno/roster', true).headers.get('location')).toBeNull();
  });
});
