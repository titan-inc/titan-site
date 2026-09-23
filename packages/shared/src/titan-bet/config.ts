import { z } from 'zod';

/**
 * Titan Bet — preparação da semana no Officer Panel (D-45; spec §16.2).
 *
 * O officer escolhe o **escopo**: encounters do catálogo do WCL (D-22), o track
 * de cada um, os mercados e a Weekly. **Pessoas nunca**: bettors e candidatos
 * são capturados pelo Ready (D-31, D-32, D-33), e o schema estrito recusa
 * qualquer lista de personagens.
 */

export const trackDoEncounterSchema = z.enum(['farm', 'progressao']);
export type TrackDoEncounter = z.infer<typeof trackDoEncounterSchema>;

/** Os mercados de boss (§6.3). A Weekly é da rodada, não de um boss. */
export const mercadoDeBossSchema = z.enum([
  'top_dps',
  'top_dps_parse',
  'top_hps',
  'top_hps_parse',
  'top_dispels',
  'first_death',
]);
export type MercadoDeBoss = z.infer<typeof mercadoDeBossSchema>;

const encounterDaPreparacaoSchema = z
  .object({
    /** Id do encounter no catálogo do WCL. Nome e zona vêm de lá, não daqui. */
    encounterId: z.number().int().positive(),
    track: trackDoEncounterSchema,
    mercados: z
      .array(mercadoDeBossSchema)
      .refine((m) => new Set(m).size === m.length, 'mercado repetido'),
  })
  .strict()
  .refine(
    (e) => e.track === 'farm' || e.mercados.every((m) => m === 'first_death'),
    'boss em progressão só tem First Death (D-29)',
  );

/**
 * A configuração inteira da semana, como está agora — salvar substitui a
 * anterior (como o Salvar do slip, D-27).
 */
export const prepararRodadaSchema = z
  .object({
    /**
     * A Weekly Progression existe nesta rodada? As opções dela são os bosses de
     * progressão (D-54) — o officer não marca boss nenhum.
     */
    weekly: z.boolean(),
    encounters: z
      .array(encounterDaPreparacaoSchema)
      .refine(
        (es) => new Set(es.map((e) => e.encounterId)).size === es.length,
        'encounter repetido',
      ),
  })
  .strict();
export type PrepararRodada = z.infer<typeof prepararRodadaSchema>;

/** A rodada como o Officer Panel mostra durante a preparação. */
export const preparacaoDaRodadaSchema = z
  .object({
    roundId: z.string(),
    period: z.number().int(),
    opensAt: z.string().datetime(),
    cutoffAt: z.string().datetime(),
    readyAt: z.string().datetime().nullable(),
    weekly: z.object({ marketId: z.string() }).strict().nullable(),
    encounters: z.array(
      z
        .object({
          roundEncounterId: z.string(),
          encounterId: z.number().int(),
          encounterName: z.string(),
          zoneName: z.string(),
          track: trackDoEncounterSchema,
          mercados: z.array(z.object({ marketId: z.string(), kind: mercadoDeBossSchema }).strict()),
        })
        .strict(),
    ),
  })
  .strict();
export type PreparacaoDaRodada = z.infer<typeof preparacaoDaRodadaSchema>;

/** O catálogo de raid do WCL, para o officer escolher os encounters (D-22). */
export const catalogoDeRaidSchema = z.object({
  zonas: z.array(
    z.object({
      zoneId: z.number().int(),
      zoneName: z.string(),
      encounters: z.array(z.object({ encounterId: z.number().int(), name: z.string() })),
    }),
  ),
});
export type CatalogoDeRaid = z.infer<typeof catalogoDeRaidSchema>;
