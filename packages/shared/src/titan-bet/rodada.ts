import { z } from 'zod';
import { mercadoDeBossSchema, trackDoEncounterSchema } from './config.js';

/**
 * Titan Bet — a rodada como o front a lê (titan-bet-test-design.md §34.1).
 *
 * Só leitura, e nada de aposta: nem stake, nem soma, nem slip de ninguém. As
 * odds têm rota própria (§16.10) e o slip é só o da conta (D-36).
 */

/**
 * As fases da §16.5. **Derivadas**, nunca coluna: o Ready é gravado, o resto
 * sai do relógio contra o `cutoffAt`, da última auditoria e do closing.
 */
export const faseDaRodadaSchema = z.enum([
  'PREPARATION',
  'NAO_ABERTA',
  'OPEN',
  'BETTING_CLOSED',
  'AUDITING',
  'CALCULATED',
  'SETTLED',
  'CLOSED',
]);
export type FaseDaRodada = z.infer<typeof faseDaRodadaSchema>;

const resumoDaRodadaSchema = z
  .object({
    roundId: z.string(),
    /** O `period` da Blizzard: a semana da rodada. */
    period: z.number().int(),
    opensAt: z.string().datetime(),
    cutoffAt: z.string().datetime(),
    fase: faseDaRodadaSchema,
  })
  .strict();
export type ResumoDaRodada = z.infer<typeof resumoDaRodadaSchema>;

/**
 * T-C01: as rodadas que a conta pode abrir, a mais recente primeiro. Membro vê
 * as publicadas (com Ready); quem saiu da guilda, só as em que tem slip (D-53a).
 */
export const rodadasDoMembroSchema = z.object({ rodadas: z.array(resumoDaRodadaSchema) }).strict();
export type RodadasDoMembro = z.infer<typeof rodadasDoMembroSchema>;

const mercadoDoCardapioSchema = z.union([
  z
    .object({
      marketId: z.string(),
      kind: mercadoDeBossSchema,
      boss: z
        .object({
          roundEncounterId: z.string(),
          encounterName: z.string(),
          track: trackDoEncounterSchema,
        })
        .strict(),
    })
    .strict(),
  // A Weekly é da rodada (D-54): as opções são os bosses de progressão.
  z
    .object({ marketId: z.string(), kind: z.literal('weekly_progression'), boss: z.null() })
    .strict(),
]);

/**
 * T-C02/T-C03: o cardápio da rodada com nomes, para o form de aposta.
 *
 * `podeApostar` é a regra de domínio (fase aberta + conta no snapshot, D-38,
 * D-53b), só antecipada para a tela — o backend recusa do mesmo jeito.
 * `personagensDoApostador` são os ids que o First Death não pode receber da
 * conta (D-56): os ligados a ela e o de elegibilidade. O depositante entra só
 * no Submeter.
 */
export const rodadaDoMembroSchema = resumoDaRodadaSchema
  .extend({
    mercados: z.array(mercadoDoCardapioSchema),
    bossesDeProgressao: z.array(
      z.object({ roundEncounterId: z.string(), encounterName: z.string() }).strict(),
    ),
    candidatos: z.array(
      z
        .object({
          characterId: z.string(),
          name: z.string(),
          realm: z.string(),
          role: z.enum(['Tank', 'Melee', 'Heal', 'Ranged']),
        })
        .strict(),
    ),
    podeApostar: z.boolean(),
    personagensDoApostador: z.array(z.string()),
  })
  .strict();
export type RodadaDoMembro = z.infer<typeof rodadaDoMembroSchema>;

/** T-C04: todas as rodadas, para o Officer Panel — inclusive em preparação. */
export const rodadasDoOfficerSchema = z
  .object({
    rodadas: z.array(
      resumoDaRodadaSchema
        .extend({
          readyAt: z.string().datetime().nullable(),
          readyByBattletag: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type RodadasDoOfficer = z.infer<typeof rodadasDoOfficerSchema>;

/**
 * T-C05: os slips submetidos da rodada, **sem as escolhas** — a porta para o
 * "ver slip" (D-57), que é quem mostra as apostas e registra o acesso.
 */
export const slipsSubmetidosSchema = z
  .object({
    slips: z.array(
      z
        .object({
          slipId: z.string(),
          ownerBattletag: z.string(),
          status: z.enum(['aguardando_deposito', 'valido', 'recusado', 'expirado']),
          depositCharacter: z.object({ name: z.string(), realm: z.string() }).strict(),
          expectedTotal: z.number().int(),
          submittedAt: z.string().datetime(),
        })
        .strict(),
    ),
  })
  .strict();
export type SlipsSubmetidos = z.infer<typeof slipsSubmetidosSchema>;
