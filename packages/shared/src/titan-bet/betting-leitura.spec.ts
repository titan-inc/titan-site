import { describe, expect, it } from 'vitest';
import { depositoPendenteSchema, meuSlipSchema } from './betting.js';

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
