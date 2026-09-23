import { z } from 'zod';

/**
 * Titan Bet — resultados de uma tentativa de Auditar, para o officer revisar
 * antes de confirmar (§7.3, D-16). Lado de officer: nenhuma aposta, slip ou
 * conta — só o desfecho, V/P/W e a evidência do que foi lido (§15.10).
 */

const mercadoCalculadoSchema = z
  .object({
    marketId: z.string(),
    kind: z.enum([
      'top_dps',
      'top_dps_parse',
      'top_hps',
      'top_hps_parse',
      'top_dispels',
      'first_death',
      'weekly_progression',
    ]),
    /** `anulado` é **proposta** de VOID: só vale com a confirmação do officer. */
    outcome: z.enum(['vencedores', 'anulado']),
    voidReason: z.string().nullable(),
    validPool: z.number().int(),
    prizePool: z.number().int().nullable(),
    winningStake: z.number().int().nullable(),
    vencedores: z.array(
      z.object({ characterId: z.string(), name: z.string(), realm: z.string() }).strict(),
    ),
    /** `K` da Weekly: ids de encounter da rodada. */
    kills: z.array(z.string()),
    evidencia: z.record(z.string(), z.unknown()),
  })
  .strict();

export const resultadosDaAuditoriaSchema = z
  .object({
    auditId: z.string(),
    status: z.enum(['aguardando_revisao', 'pronta', 'calculada', 'confirmada', 'substituida']),
    calculatedAt: z.string().datetime().nullable(),
    mercados: z.array(mercadoCalculadoSchema),
  })
  .strict();
export type ResultadosDaAuditoria = z.infer<typeof resultadosDaAuditoriaSchema>;
