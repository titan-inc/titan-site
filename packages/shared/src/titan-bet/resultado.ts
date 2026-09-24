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
    /**
     * `sem_vencedor`: resultado válido sem vencedor premiável — o prize pool vai
     * para os outros mercados no settlement (D-61). `anulado`: VOID, com
     * restituição; só vale com a confirmação do officer (D-16).
     */
    outcome: z.enum(['vencedores', 'sem_vencedor', 'anulado']),
    /** Por que não houve vencedor, ou por que foi VOID. */
    motivo: z.string().nullable(),
    validPool: z.number().int(),
    prizePool: z.number().int().nullable(),
    winningStake: z.number().int().nullable(),
    vencedores: z.array(
      z.object({ characterId: z.string(), name: z.string(), realm: z.string() }).strict(),
    ),
    /** Weekly (D-54): os bosses de progressão mortos — ids de encounter da rodada. */
    bossesVencedores: z.array(z.string()),
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
