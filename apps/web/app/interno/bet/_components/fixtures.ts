import type { ClosingPublicado, MeuSlip, OddsDaRodada, RodadaDoMembro } from '@titan/shared';

/**
 * Dados fictícios para os testes da superfície do Titan Bet. Nenhum nome real
 * de membro (CLAUDE.md, Segredos).
 */

export const CARDAPIO: RodadaDoMembro = {
  roundId: 'r1',
  period: 1042,
  opensAt: '2026-09-22T15:00:00.000Z',
  cutoffAt: '2026-09-29T15:00:00.000Z',
  fase: 'OPEN',
  mercados: [
    {
      marketId: 'm-dps',
      kind: 'top_dps',
      boss: { roundEncounterId: 'e1', encounterName: 'Boss Farm', track: 'farm' },
    },
    {
      marketId: 'm-fd',
      kind: 'first_death',
      boss: { roundEncounterId: 'e1', encounterName: 'Boss Farm', track: 'farm' },
    },
    { marketId: 'm-weekly', kind: 'weekly_progression', boss: null },
  ],
  bossesDeProgressao: [
    { roundEncounterId: 'e2', encounterName: 'Boss Novo' },
    { roundEncounterId: 'e3', encounterName: 'Boss Final' },
  ],
  candidatos: [
    { characterId: 'c-meu', name: 'Meupersonagem', realm: 'Azralon', role: 'Melee' },
    { characterId: 'c-outro', name: 'Outropersonagem', realm: 'Azralon', role: 'Ranged' },
    { characterId: 'c-cura', name: 'Curandeiro', realm: 'Goldrinn', role: 'Heal' },
  ],
  podeApostar: true,
  personagensDoApostador: ['c-meu'],
};

export const ODDS: OddsDaRodada = {
  roundId: 'r1',
  mercados: [
    {
      marketId: 'm-dps',
      opcoes: [
        { characterId: 'c-meu', multiplicador: 2.5 },
        { characterId: 'c-outro', multiplicador: null },
      ],
    },
    {
      marketId: 'm-fd',
      opcoes: [
        { characterId: 'c-meu', multiplicador: 3 },
        { characterId: 'c-outro', multiplicador: 1.8 },
        { characterId: 'c-cura', multiplicador: null },
      ],
    },
    {
      marketId: 'm-weekly',
      opcoes: [
        { roundEncounterId: 'e2', multiplicador: 1.5 },
        { roundEncounterId: 'e3', multiplicador: null },
      ],
    },
  ],
};

export const RASCUNHO: MeuSlip = {
  slipId: 's1',
  status: 'rascunho',
  apostas: [{ marketId: 'm-dps', stake: 300, targetCharacterId: 'c-outro' }],
  depositCharacter: null,
  expectedTotal: null,
  rejectionReason: null,
};

export const CLOSING: ClosingPublicado = {
  version: 1,
  publishedAt: '2026-10-01T15:00:00.000Z',
  conteudo: {
    versao: 1,
    roundId: 'r1',
    period: 1042,
    mercados: [
      {
        marketId: 'm-dps',
        kind: 'top_dps',
        encounterName: 'Boss Farm',
        desfecho: 'vencedores',
        motivo: null,
        vencedores: [{ name: 'Outropersonagem', realm: 'Azralon' }],
        bossesVencedores: [],
        ganhos: [{ membro: { name: 'Apostadorum', realm: 'Azralon' }, valor: 2173 }],
      },
      {
        marketId: 'm-fd',
        kind: 'first_death',
        encounterName: 'Boss Farm',
        desfecho: 'sem_vencedor',
        motivo: 'sem_kill',
        vencedores: [],
        bossesVencedores: [],
        ganhos: [],
      },
      {
        marketId: 'm-weekly',
        kind: 'weekly_progression',
        encounterName: null,
        desfecho: 'vencedores',
        motivo: null,
        vencedores: [],
        bossesVencedores: ['Boss Novo'],
        ganhos: [{ membro: { name: 'Apostadorum', realm: 'Azralon' }, valor: 900 }],
      },
    ],
    guildBank: { receita: 330, residuo: 2 },
    totais: [{ membro: { name: 'Apostadorum', realm: 'Azralon' }, devido: 3073 }],
  },
};

export function resposta(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
