import { describe, expect, it } from 'vitest';
import { catalogoDeRaidSchema, preparacaoDaRodadaSchema, prepararRodadaSchema } from './config.js';

/**
 * Contrato da preparação da semana no Officer Panel (D-45; spec §16.2).
 * T-G04 (mercados por track) e T-G09 (sem escolha de pessoa).
 */

const farm = (encounterId: number, mercados: string[] = ['top_dps']) => ({
  encounterId,
  track: 'farm',
  mercados,
});

describe('prepararRodadaSchema', () => {
  it('aceita farm com os seis mercados de boss e a Weekly ligada', () => {
    const r = prepararRodadaSchema.safeParse({
      weekly: true,
      encounters: [
        {
          ...farm(1, [
            'top_dps',
            'top_dps_parse',
            'top_hps',
            'top_hps_parse',
            'top_dispels',
            'first_death',
          ]),
        },
        {
          encounterId: 2,
          track: 'progressao',
          mercados: ['first_death'],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('T-G04: progressão aceita só First Death (D-29)', () => {
    const r = prepararRodadaSchema.safeParse({
      weekly: false,
      encounters: [{ encounterId: 2, track: 'progressao', mercados: ['top_dps'] }],
    });
    expect(r.success).toBe(false);
  });

  it('a Weekly não é mercado de boss', () => {
    expect(
      prepararRodadaSchema.safeParse({
        weekly: false,
        encounters: [farm(1, ['weekly_progression'])],
      }).success,
    ).toBe(false);
  });

  // Mudança de produto (D-54): o officer não marca mais bosses da Weekly — ela
  // usa os de progressão. Substitui "boss marcado na Weekly exige a Weekly ligada".
  it('T-W15: a marcação de boss da Weekly não existe mais no contrato', () => {
    expect(
      prepararRodadaSchema.safeParse({
        weekly: true,
        encounters: [{ ...farm(1), inWeeklyProgression: true }],
      }).success,
    ).toBe(false);
  });

  it('encounter e mercado sem repetição', () => {
    expect(
      prepararRodadaSchema.safeParse({ weekly: false, encounters: [farm(1), farm(1)] }).success,
    ).toBe(false);
    expect(
      prepararRodadaSchema.safeParse({
        weekly: false,
        encounters: [farm(1, ['top_dps', 'top_dps'])],
      }).success,
    ).toBe(false);
  });

  it('T-G09: candidatos e bettors não se escolhem à mão — o schema é estrito', () => {
    expect(
      prepararRodadaSchema.safeParse({ weekly: false, encounters: [], candidatos: ['c1'] }).success,
    ).toBe(false);
    expect(
      prepararRodadaSchema.safeParse({ weekly: false, encounters: [], bettors: ['c1'] }).success,
    ).toBe(false);
    expect(
      prepararRodadaSchema.safeParse({
        weekly: false,
        encounters: [{ ...farm(1), candidatos: ['c1'] }],
      }).success,
    ).toBe(false);
  });

  it('nome e zona do boss não vêm do officer — vêm do catálogo do WCL (D-22)', () => {
    expect(
      prepararRodadaSchema.safeParse({
        weekly: false,
        encounters: [{ ...farm(1), encounterName: 'Qualquer' }],
      }).success,
    ).toBe(false);
  });
});

describe('preparacaoDaRodadaSchema', () => {
  it('a vista da rodada em preparação', () => {
    const vista = {
      roundId: 'r1',
      period: 1050,
      opensAt: '2026-09-25T03:00:00.000Z',
      cutoffAt: '2026-09-29T15:00:00.000Z',
      readyAt: null,
      weekly: { marketId: 'w1' },
      encounters: [
        {
          roundEncounterId: 'e1',
          encounterId: 1,
          encounterName: 'Boss',
          zoneName: 'Raid',
          track: 'farm',
          mercados: [{ marketId: 'm1', kind: 'top_dps' }],
        },
      ],
    };
    expect(preparacaoDaRodadaSchema.parse(vista)).toEqual(vista);
  });
});

/**
 * B2 (titan-bet-test-design.md §41): o catálogo diz qual é o conteúdo atual da
 * guilda — a zone da atividade de raid real mais recente —, ou `null` quando não
 * dá para dizer. Quem mostra decide filtrar; o catálogo inteiro continua vindo.
 */
describe('catalogoDeRaidSchema — o conteúdo atual', () => {
  const zonas = [
    { zoneId: 46, zoneName: 'VS / DR / MQD', encounters: [{ encounterId: 3176, name: 'Boss' }] },
    {
      zoneId: 53,
      zoneName: 'The Venomous Abyss',
      encounters: [{ encounterId: 3470, name: 'Boss' }],
    },
  ];

  it('com a zone atual inferida', () => {
    expect(catalogoDeRaidSchema.parse({ zonas, zonaAtual: 53 })).toEqual({ zonas, zonaAtual: 53 });
  });

  it('sem conteúdo atual determinado: null, e o catálogo inteiro', () => {
    expect(catalogoDeRaidSchema.parse({ zonas, zonaAtual: null }).zonaAtual).toBeNull();
  });

  it('o campo é obrigatório: quem lê precisa saber se houve inferência', () => {
    expect(catalogoDeRaidSchema.safeParse({ zonas }).success).toBe(false);
  });
});
