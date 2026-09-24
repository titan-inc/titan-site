import type {
  AuditoriaCorrente,
  CatalogoDeRaid,
  DepositoPendente,
  PreparacaoDaRodada,
  ResultadosDaAuditoria,
  SaldosDaRodada,
  SlipDoOfficer,
  SlipsSubmetidos,
} from '@titan/shared';

/** Dados fictícios do Officer Panel — nenhum nome real (CLAUDE.md, Segredos). */

export const OFFICER_BT = 'Officer#0001';

export const CATALOGO: CatalogoDeRaid = {
  // Sem conteúdo atual inferido: a tela mostra o catálogo inteiro.
  zonaAtual: null,
  zonas: [
    {
      zoneId: 1,
      zoneName: 'Raid de Teste',
      encounters: [
        { encounterId: 101, name: 'Boss Farm' },
        { encounterId: 102, name: 'Boss Novo' },
      ],
    },
  ],
};

/**
 * Catálogo com tiers e espelho, como o real (B2): 46 é o tier anterior, 53 o
 * atual (inferido da atividade real), 54 o espelho de Beta da 53.
 */
export const CATALOGO_COM_TIER: CatalogoDeRaid = {
  zonaAtual: 53,
  zonas: [
    {
      zoneId: 46,
      zoneName: 'Tier Anterior',
      encounters: [{ encounterId: 3176, name: 'Boss Antigo' }],
    },
    {
      zoneId: 53,
      zoneName: 'Tier Atual',
      encounters: [
        { encounterId: 101, name: 'Boss Farm' },
        { encounterId: 102, name: 'Boss Novo' },
      ],
    },
    {
      zoneId: 54,
      zoneName: 'Tier Atual (Beta)',
      encounters: [{ encounterId: 50101, name: 'Boss Farm' }],
    },
  ],
};

export const PREPARACAO: PreparacaoDaRodada = {
  roundId: 'r1',
  period: 1042,
  opensAt: '2026-09-22T15:00:00.000Z',
  cutoffAt: '2026-09-29T15:00:00.000Z',
  readyAt: null,
  weekly: null,
  encounters: [],
};

export const DEPOSITOS: DepositoPendente[] = [
  {
    slipId: 's-outro',
    ownerBattletag: 'Membro#1234',
    depositCharacter: { name: 'Depositante', realm: 'Azralon' },
    expectedTotal: 500,
    status: 'aguardando_deposito',
    submittedAt: '2026-09-23T15:00:00.000Z',
  },
  {
    slipId: 's-meu',
    ownerBattletag: OFFICER_BT,
    depositCharacter: { name: 'Meudeposito', realm: 'Azralon' },
    expectedTotal: 300,
    status: 'aguardando_deposito',
    submittedAt: '2026-09-23T16:00:00.000Z',
  },
];

export const SLIPS: SlipsSubmetidos = {
  slips: [
    {
      slipId: 's1',
      ownerBattletag: 'Membro#1234',
      status: 'valido',
      depositCharacter: { name: 'Depositante', realm: 'Azralon' },
      expectedTotal: 500,
      submittedAt: '2026-09-23T15:00:00.000Z',
    },
  ],
};

export const SLIP_VISTO: SlipDoOfficer = {
  slipId: 's1',
  roundId: 'r1',
  status: 'valido',
  ownerBattletag: 'Membro#1234',
  eligibilityCharacter: { name: 'Elegivel', realm: 'Azralon' },
  depositCharacter: { name: 'Depositante', realm: 'Azralon' },
  expectedTotal: 500,
  submittedAt: '2026-09-23T15:00:00.000Z',
  apostas: [
    {
      marketId: 'm1',
      marketKind: 'top_dps',
      stake: 300,
      alvo: { characterId: 'c1', name: 'Alvoescolhido', realm: 'Azralon' },
    },
    {
      marketId: 'm2',
      marketKind: 'weekly_progression',
      stake: 200,
      boss: { roundEncounterId: 'e2', encounterName: 'Boss Novo' },
    },
  ],
  validatedByBattletag: OFFICER_BT,
  validatedAt: '2026-09-23T17:00:00.000Z',
  rejectedByBattletag: null,
  rejectedAt: null,
  rejectionReason: null,
  expiredAt: null,
};

export const AUDITORIA: AuditoriaCorrente = {
  auditId: 'a1',
  attempt: 1,
  status: 'aguardando_revisao',
  startedByBattletag: OFFICER_BT,
  startedAt: '2026-09-30T15:00:00.000Z',
  fontes: [
    {
      session: 'terca',
      resolution: 'automatica',
      reports: [
        {
          code: 'AbC123',
          title: 'titanbet terça',
          revision: 3,
          startTime: '2026-09-30T00:00:00.000Z',
        },
        {
          code: 'XyZ789',
          title: 'titanbet terça 2',
          revision: 1,
          startTime: '2026-09-30T01:00:00.000Z',
        },
      ],
      motivoSemRaid: null,
      resolvedByBattletag: null,
      resolvedAt: null,
    },
    {
      session: 'quinta',
      resolution: 'ausente',
      reports: [],
      motivoSemRaid: null,
      resolvedByBattletag: null,
      resolvedAt: null,
    },
  ],
};

export const RESULTADOS: ResultadosDaAuditoria = {
  auditId: 'a1',
  status: 'calculada',
  calculatedAt: '2026-09-30T16:00:00.000Z',
  mercados: [
    {
      marketId: 'm1',
      kind: 'top_dps',
      outcome: 'vencedores',
      motivo: null,
      validPool: 1000,
      prizePool: 900,
      winningStake: 300,
      vencedores: [{ characterId: 'c1', name: 'Alvoescolhido', realm: 'Azralon' }],
      bossesVencedores: [],
      evidencia: {},
    },
    {
      marketId: 'm3',
      kind: 'first_death',
      outcome: 'sem_vencedor',
      motivo: 'sem_kill',
      validPool: 400,
      prizePool: 360,
      winningStake: 0,
      vencedores: [],
      bossesVencedores: [],
      evidencia: {},
    },
    {
      marketId: 'm2',
      kind: 'weekly_progression',
      outcome: 'vencedores',
      motivo: null,
      validPool: 600,
      prizePool: 540,
      winningStake: 200,
      vencedores: [],
      bossesVencedores: ['e2'],
      evidencia: {},
    },
  ],
};

export const SALDOS: SaldosDaRodada = {
  saldos: [{ slipId: 's1', ownerBattletag: 'Membro#1234', devido: 2173, pago: 0 }],
};

export function resposta(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
