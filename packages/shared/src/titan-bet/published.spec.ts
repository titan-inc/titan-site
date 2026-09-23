import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { closingReportSchema, oddsDaRodadaSchema } from './published.js';

/**
 * Contrato PUBLICADO do Titan Bet (spec §9.1, §16.10). T-O03: a resposta de
 * odds não carrega dado individual — só o multiplicador por opção.
 */

const odds = {
  roundId: 'r1',
  mercados: [
    {
      marketId: 'm1',
      opcoes: [
        { characterId: 'c1', multiplicador: 3 },
        { characterId: 'c2', multiplicador: null },
      ],
    },
  ],
};

describe('T-O03 — odds sem dado individual (D-36, §16.10)', () => {
  it('afirma os campos obrigatórios em cada nível, e só eles', () => {
    expect(Object.keys(oddsDaRodadaSchema.shape).sort()).toEqual(['mercados', 'roundId']);
    expect(oddsDaRodadaSchema.parse(odds)).toEqual(odds);
  });

  it.each(['userId', 'ownerUserId', 'slipId', 'stake', 'apostas', 'ownerBattletag'])(
    'recusa %s em qualquer nível — estrito, não descarta em silêncio',
    (campo) => {
      expect(oddsDaRodadaSchema.safeParse({ ...odds, [campo]: 'x' }).success).toBe(false);

      const mercado = { ...odds.mercados[0], [campo]: 'x' };
      expect(oddsDaRodadaSchema.safeParse({ ...odds, mercados: [mercado] }).success).toBe(false);

      const opcao = { characterId: 'c1', multiplicador: 3, [campo]: 'x' };
      expect(
        oddsDaRodadaSchema.safeParse({
          ...odds,
          mercados: [{ marketId: 'm1', opcoes: [opcao] }],
        }).success,
      ).toBe(false);
    },
  );

  it('T-W18: a Weekly tem um multiplicador por boss de progressão (D-54)', () => {
    const weekly = {
      marketId: 'w',
      opcoes: [
        { roundEncounterId: 'e1', multiplicador: 2.5 },
        { roundEncounterId: 'e2', multiplicador: null },
      ],
    };
    expect(oddsDaRodadaSchema.parse({ ...odds, mercados: [weekly] })).toEqual({
      ...odds,
      mercados: [weekly],
    });
  });

  it('opção é personagem ou boss, nunca os dois', () => {
    const ambos = { characterId: 'c1', roundEncounterId: 'e1', multiplicador: 1 };
    expect(
      oddsDaRodadaSchema.safeParse({ ...odds, mercados: [{ marketId: 'm', opcoes: [ambos] }] })
        .success,
    ).toBe(false);
  });

  it('opção sem aposta é "—": multiplicador nulo, nunca zero (R-35)', () => {
    const zero = { marketId: 'm1', opcoes: [{ characterId: 'c1', multiplicador: 0 }] };
    expect(oddsDaRodadaSchema.safeParse({ ...odds, mercados: [zero] }).success).toBe(false);
  });
});

/**
 * T-Z05 (§9.1) — **guarda de regressão**, sem RED (test-design §5.4): o
 * contrato publicado não importa o privado. Importar traria para cá os tipos do
 * slip, e o próximo schema publicado os usaria num `extend` conveniente.
 */
describe('T-Z05 — published não importa betting', () => {
  it('nenhum import de ./betting no módulo publicado', () => {
    const fonte = readFileSync(new URL('./published.ts', import.meta.url), 'utf8');
    const imports = [...fonte.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports).toEqual(['zod']);
  });
});

/**
 * T-C01/T-C04 no contrato — o Round Closing Report publicado (D-21, D-48;
 * §8.5, §16.7). O membro é o personagem de elegibilidade; nunca BattleTag,
 * stake, aposta perdedora, escolha, slip ou depósito.
 */
describe('closingReportSchema', () => {
  const quem = { name: 'Fulano', realm: 'Azralon' };
  const doc = {
    versao: 1,
    roundId: 'r1',
    period: 1050,
    mercados: [
      {
        marketId: 'm1',
        kind: 'top_dps',
        encounterName: 'Boss Um',
        desfecho: 'vencedores',
        motivo: null,
        vencedores: [{ name: 'Candidato', realm: 'Azralon' }],
        bossesVencedores: [],
        ganhos: [{ membro: quem, valor: 1440 }],
      },
      {
        marketId: 'm2',
        kind: 'first_death',
        encounterName: 'Boss Um',
        desfecho: 'sem_vencedor',
        motivo: 'sem_kill',
        vencedores: [],
        bossesVencedores: [],
        ganhos: [],
      },
      {
        marketId: 'm3',
        kind: 'weekly_progression',
        encounterName: null,
        desfecho: 'vencedores',
        motivo: null,
        vencedores: [],
        bossesVencedores: ['Boss Um'],
        ganhos: [],
      },
    ],
    guildBank: { receita: 160, residuo: 1 },
    totais: [{ membro: quem, devido: 1440 }],
  };

  // Mudança de produto (D-54, D-61): o desfecho ganha `sem_vencedor`, o motivo
  // vale para ele e para `anulado`, e a Weekly publica os bosses vencedores.
  it('aceita o documento com mercados, sem vencedor, Weekly, Guild Bank e totais', () => {
    expect(closingReportSchema.parse(doc)).toEqual(doc);
  });

  it.each(['stake', 'slipId', 'ownerBattletag', 'battletag', 'apostas', 'deposito'])(
    'recusa %s em qualquer nível',
    (campo) => {
      expect(closingReportSchema.safeParse({ ...doc, [campo]: 'x' }).success).toBe(false);
      const mercado = { ...doc.mercados[0], [campo]: 'x' };
      expect(closingReportSchema.safeParse({ ...doc, mercados: [mercado] }).success).toBe(false);
      const ganho = { membro: quem, valor: 1, [campo]: 'x' };
      expect(
        closingReportSchema.safeParse({
          ...doc,
          mercados: [{ ...doc.mercados[0], ganhos: [ganho] }],
        }).success,
      ).toBe(false);
      const membro = { ...quem, [campo]: 'x' };
      expect(
        closingReportSchema.safeParse({ ...doc, totais: [{ membro, devido: 1 }] }).success,
      ).toBe(false);
    },
  );

  it('membro é personagem: nome e realm, e só isso (D-48)', () => {
    expect(
      closingReportSchema.safeParse({ ...doc, totais: [{ membro: { name: 'X' }, devido: 1 }] })
        .success,
    ).toBe(false);
  });
});
