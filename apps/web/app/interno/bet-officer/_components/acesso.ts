import { isActingOfficer, type SessionUser } from '@titan/shared';

/**
 * Para onde mandar quem abre o Officer Panel do Titan Bet, ou `null` para ficar
 * (T-UI20).
 *
 * Checa a **precondição** `isActingOfficer`, a mesma do `OfficerGuard` — nunca
 * uma permissão específica (CLAUDE.md, Regra 4). É UX: quem barra de verdade é
 * o guard no Nest (Regra 5).
 */
export function destinoDoPainel(user: SessionUser | null): string | null {
  if (!user) return '/?erro=sessao';
  if (!isActingOfficer(user)) return '/interno';
  return null;
}
