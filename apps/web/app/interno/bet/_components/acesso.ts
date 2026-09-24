import type { SessionUser } from '@titan/shared';

/** O que a API respondeu à primeira leitura da página. */
export type RespostaDaApi = 'ok' | 'proibido' | 'indisponivel';

/**
 * Para onde mandar quem abre `/interno/bet`, ou `null` para ficar (T-UI01).
 *
 * **Não** decide por `membership`, como o M+ faz: quem saiu da guilda com slip
 * numa rodada continua nela (D-53a, D-68), e quem sabe disso é o
 * `ApostadorDaRodadaGuard` no Nest. A página segue a resposta da API — 403 volta
 * para `/interno`, que explica o estado da conta. É UX; a regra é o guard
 * (Regra 5).
 */
export function destinoDaPaginaBet(user: SessionUser | null, api: RespostaDaApi): string | null {
  if (!user) return '/?erro=sessao';
  if (api === 'proibido') return '/interno';
  return null;
}
