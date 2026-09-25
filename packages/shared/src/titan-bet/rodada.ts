import { z } from 'zod';
import { mercadoDeBossSchema, trackDoEncounterSchema } from './config.js';
import { camposDaSubmissao, submissaoCoerente } from './submissao.js';

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
  /** Cancelada por um officer, com motivo (D-77): terminal, vence as outras. */
  'CANCELLED',
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
          /**
           * A rodada pode ser auditada agora (D-73)? A API decide com a mesma
           * regra do Auditar; o painel mostra, não compara relógio.
           */
          podeAuditar: z.boolean(),
          /** Quinta 23:30 no fuso da guilda: quando a auditoria abre (D-73). */
          auditavelDesde: z.string().datetime(),
          /** A rodada ainda pode ser cancelada (D-77)? A API decide. */
          podeCancelar: z.boolean(),
          /** Quem cancelou, quando e por quê; `null` se não foi cancelada (D-77). */
          cancelamento: z
            .object({ motivo: z.string(), em: z.string().datetime(), porBattletag: z.string() })
            .strict()
            .nullable(),
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
          status: z.enum(['aguardando_deposito', 'valido', 'recusado', 'expirado', 'cancelado']),
          ...camposDaSubmissao,
          /**
           * O depósito foi confirmado (o slip chegou a `valido`). Num slip
           * `cancelado`, é o que os officers devolvem fora do Titan Bet (D-77).
           */
          depositoConfirmado: z.boolean(),
        })
        .strict()
        .superRefine(submissaoCoerente),
    ),
  })
  .strict();
export type SlipsSubmetidos = z.infer<typeof slipsSubmetidosSchema>;

/** Cancelar a rodada (D-77): o motivo é obrigatório. */
export const cancelarRodadaSchema = z
  .object({ motivo: z.string().trim().min(1, 'o cancelamento exige motivo').max(500) })
  .strict();
export type CancelarRodada = z.infer<typeof cancelarRodadaSchema>;
