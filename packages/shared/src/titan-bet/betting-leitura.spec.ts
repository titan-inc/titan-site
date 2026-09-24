import { describe, expect, it } from 'vitest';
import { depositoPendenteSchema, meuSlipSchema, slipDoOfficerSchema } from './betting.js';

/**
 * O que as rotas do Titan Bet devolvem do lado privado (spec §9.1, §16.9).
 * titan-bet-test-design.md, milestone "RED/GREEN Autorização".
 */

const deposito = {
  slipId: 's1',
  ownerBattletag: 'Membro#1234',
  depositCharacter: { name: 'Depositante', realm: 'Azralon' },
  expectedTotal: 1200,
  status: 'aguardando_deposito',
  submittedAt: '2026-09-23T15:00:00.000Z',
};

describe('T-D01 — DTO de depósito sem escolhas (D-36)', () => {
  it('tem exatamente membro, depositante, total, status e horário', () => {
    // Afirmar os campos obrigatórios, e não só a ausência dos privados (§5.5):
    // um schema vazio também "não tem stake".
    expect(Object.keys(depositoPendenteSchema.shape).sort()).toEqual(
      [
        'depositCharacter',
        'expectedTotal',
        'ownerBattletag',
        'slipId',
        'status',
        'submittedAt',
      ].sort(),
    );
    expect(depositoPendenteSchema.parse(deposito)).toEqual(deposito);
  });

  it.each([
    ['apostas', [{ marketId: 'm1', stake: 300, targetCharacterId: 'c1' }]],
    ['marketId', 'm1'],
    ['stake', 300],
    ['targetCharacterId', 'c1'],
    ['encounterId', 'e1'],
  ])('recusa o campo de aposta %s — estrito, não descarta em silêncio', (campo, valor) => {
    expect(depositoPendenteSchema.safeParse({ ...deposito, [campo]: valor }).success).toBe(false);
  });

  it('só descreve depósito submetido: total inteiro e depositante presentes', () => {
    expect(depositoPendenteSchema.safeParse({ ...deposito, expectedTotal: 200.5 }).success).toBe(
      false,
    );
    expect(depositoPendenteSchema.safeParse({ ...deposito, depositCharacter: null }).success).toBe(
      false,
    );
    expect(depositoPendenteSchema.safeParse({ ...deposito, status: 'rascunho' }).success).toBe(
      false,
    );
  });
});

describe('meuSlipSchema — o próprio slip, para o dono', () => {
  const slip = {
    slipId: 's1',
    status: 'rascunho',
    apostas: [
      { marketId: 'm1', stake: 300, targetCharacterId: 'c1' },
      { marketId: 'm2', stake: 200, encounterId: 'e1' },
    ],
    depositCharacter: null,
    expectedTotal: null,
    rejectionReason: null,
  };

  it('aceita o rascunho com as apostas na mesma forma do Salvar', () => {
    expect(meuSlipSchema.parse(slip)).toEqual(slip);
  });

  it('é estrito: não carrega o id da conta — a sessão já diz de quem é', () => {
    expect(meuSlipSchema.safeParse({ ...slip, ownerUserId: 'u1' }).success).toBe(false);
  });

  it('recusa status fora do ciclo de vida', () => {
    expect(meuSlipSchema.safeParse({ ...slip, status: 'pago' }).success).toBe(false);
  });

  // Mudança de produto (D-55): o dono vê o depositante como informou — nome e
  // realm, congelados no Submeter —, não um id.
  it('T-S26: depois do Submeter, o depositante volta com nome e realm', () => {
    const submetido = {
      ...slip,
      status: 'aguardando_deposito',
      depositCharacter: { name: 'Qualquer', realm: 'Azralon' },
      expectedTotal: 500,
    };
    expect(meuSlipSchema.parse(submetido)).toEqual(submetido);
    expect(meuSlipSchema.safeParse({ ...submetido, depositCharacterId: 'c1' }).success).toBe(false);
  });
});

describe('T-Z09 — "ver slip" do officer: o slip como foi submetido (D-57)', () => {
  const visto = {
    slipId: 's1',
    roundId: 'r1',
    status: 'aguardando_deposito',
    ownerBattletag: 'Membro#1234',
    eligibilityCharacter: { name: 'Elegivel', realm: 'Azralon' },
    depositCharacter: { name: 'Depositante', realm: 'Azralon' },
    expectedTotal: 500,
    submittedAt: '2026-09-23T15:00:00.000Z',
    apostas: [
      {
        marketId: 'm1',
        marketKind: 'first_death',
        stake: 300,
        alvo: { characterId: 'c1', name: 'Alvo', realm: 'Azralon' },
      },
      {
        marketId: 'm2',
        marketKind: 'weekly_progression',
        stake: 200,
        boss: { roundEncounterId: 'e1', encounterName: 'Boss' },
      },
    ],
    validatedByBattletag: null,
    validatedAt: null,
    rejectedByBattletag: null,
    rejectedAt: null,
    rejectionReason: null,
    expiredAt: null,
  };

  it('carrega dono, personagens, total e as apostas com o alvo legível', () => {
    expect(slipDoOfficerSchema.parse(visto)).toEqual(visto);
  });

  it('D-71: expirado que nunca foi submetido vem sem data, total e depositante', () => {
    const nunca = {
      ...visto,
      status: 'expirado',
      depositCharacter: null,
      expectedTotal: null,
      submittedAt: null,
      expiredAt: '2026-09-29T15:00:00.000Z',
    };
    expect(slipDoOfficerSchema.parse(nunca)).toEqual(nunca);
    expect(slipDoOfficerSchema.safeParse({ ...nunca, status: 'valido' }).success).toBe(false);
    expect(slipDoOfficerSchema.safeParse({ ...nunca, expectedTotal: 500 }).success).toBe(false);
  });

  it('rascunho não é "como foi submetido": fora do contrato', () => {
    expect(slipDoOfficerSchema.safeParse({ ...visto, status: 'rascunho' }).success).toBe(false);
  });

  it('é estrito: não carrega id de conta nem nada além do slip', () => {
    expect(slipDoOfficerSchema.safeParse({ ...visto, ownerUserId: 'u1' }).success).toBe(false);
  });

  it('Weekly aposta num boss; os outros mercados, num personagem', () => {
    const trocada = {
      ...visto,
      apostas: [
        {
          marketId: 'm2',
          marketKind: 'weekly_progression',
          stake: 200,
          alvo: visto.apostas[0]!.alvo,
        },
      ],
    };
    expect(slipDoOfficerSchema.safeParse(trocada).success).toBe(false);
  });
});
