import type { BetCandidateRole, BetMarketKind } from '@prisma/client';

/** Um personagem do snapshot de candidatos da rodada, com a role congelada. */
export interface Candidato {
  characterId: string;
  role: BetCandidateRole;
}

/**
 * Roles que cada tipo de mercado aceita (D-04). `null` = todas.
 *
 * É a mesma regra que o CHECK `Bet_role_conforme_tipo` garante no banco; aqui
 * ela serve para montar o cardápio, e o banco segura a escrita.
 */
const ROLES_DO_MERCADO: Record<BetMarketKind, readonly BetCandidateRole[] | null> = {
  top_dps: ['Melee', 'Ranged'],
  top_dps_parse: ['Melee', 'Ranged'],
  top_hps: ['Heal'],
  top_hps_parse: ['Heal'],
  top_dispels: null,
  first_death: null,
  weekly_progression: [],
};

/**
 * Os candidatos de um mercado: o snapshot congelado no Ready, filtrado pela
 * role do tipo. Participação real (WCL) não entra — elegibilidade não é
 * participação (D-13).
 */
export function candidatosDoMercado(kind: BetMarketKind, snapshot: Candidato[]): Candidato[] {
  const roles = ROLES_DO_MERCADO[kind];
  if (roles === null) return [...snapshot];
  return snapshot.filter((c) => roles.includes(c.role));
}
