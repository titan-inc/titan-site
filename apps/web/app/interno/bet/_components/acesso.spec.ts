import type { SessionUser } from '@titan/shared';
import { describe, expect, it } from 'vitest';
import { destinoDaPaginaBet } from './acesso';

/**
 * F1 — T-UI01: quem entra em `/interno/bet` (D-53a). A página não decide por
 * `membership`, como o M+: quem decide é o `ApostadorDaRodadaGuard`, e a página
 * segue a resposta da API. Isto é UX; o 403 do Nest é a regra (Regra 5).
 */

const membro = { membership: 'member' } as SessionUser;
const exMembro = { membership: 'not-member' } as SessionUser;

describe('destinoDaPaginaBet', () => {
  it('sem sessão → login', () => {
    expect(destinoDaPaginaBet(null, 'ok')).toBe('/?erro=sessao');
  });

  it('ex-membro que a API deixou passar (tem slip) → fica na página', () => {
    expect(destinoDaPaginaBet(exMembro, 'ok')).toBeNull();
  });

  it('a API recusou (403) → volta para /interno, que explica o estado', () => {
    expect(destinoDaPaginaBet(exMembro, 'proibido')).toBe('/interno');
    expect(destinoDaPaginaBet(membro, 'proibido')).toBe('/interno');
  });

  it('API fora do ar não expulsa ninguém: a página mostra o erro', () => {
    expect(destinoDaPaginaBet(membro, 'indisponivel')).toBeNull();
  });
});
