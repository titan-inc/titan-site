import type { RaidProgressReport } from '@titan/shared';
import './index';

const nomes = [
  'O Vigia',
  'A Fundição',
  'Arquivista',
  'Conselho',
  'A Fenda',
  'Sentinela',
  'O Vazio',
  'Nexus',
];

function relatorio(kills: number, total = 8): RaidProgressReport {
  const bosses = nomes.slice(0, total).map((name, indice) => ({
    encounterId: 9000 + indice,
    name,
    byDifficulty: [
      {
        difficulty: 5,
        pulls: 18 + indice * 11,
        kills: indice < kills ? 1 : 0,
        firstKillAt:
          indice < kills ? new Date(Date.UTC(2026, 5, 4 + indice * 3)).toISOString() : null,
        bestPercent:
          indice === kills && kills < total ? 3.7 : indice < kills ? null : 68.4 - indice * 4.1,
      },
    ],
  }));
  return {
    season: { id: 1, name: 'Season 1', patch: '12.0' },
    availableSeasons: [{ id: 1, name: 'Season 1', patch: '12.0' }],
    difficulties: [{ id: 5, name: 'Mythic' }],
    raids: [{ id: 1200, name: 'Complexo Meridian', tier: 'Season 1 · 12.0', bosses }],
    fetchedAt: '2026-08-05T14:02:00.000Z',
    stale: false,
  };
}

export const PROGRESSAO_MOCK_PARCIAL = relatorio(6);
export const PROGRESSAO_MOCK_ZERO = relatorio(0);
export const PROGRESSAO_MOCK_COMPLETA = relatorio(8);
export const PROGRESSAO_MOCK_TRES_BOSSES = relatorio(2, 3);
