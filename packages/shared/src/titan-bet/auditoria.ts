import { z } from 'zod';

/**
 * Titan Bet — Auditar no Officer Panel (D-30, D-60, D-63; spec §7.2).
 *
 * Lado de officer: as fontes de cada sessão (todos os `titanbet*`) e a
 * declaração de "sem raid oficial". Não carrega aposta nenhuma.
 */

/** As duas sessões de evidência da rodada (D-19, D-23) — não existe outra. */
export const sessaoDaAuditoriaSchema = z.enum(['terca', 'quinta']);
export type SessaoDaAuditoria = z.infer<typeof sessaoDaAuditoriaSchema>;

/** Um report `titanbet*` como o WCL respondeu no Auditar — a referência congelada. */
const reportDaAuditoriaSchema = z
  .object({
    code: z.string(),
    title: z.string(),
    revision: z.number().int(),
    startTime: z.string().datetime(),
  })
  .strict();

const fonteDaAuditoriaSchema = z
  .object({
    session: sessaoDaAuditoriaSchema,
    /**
     * `automatica`: os `titanbet*` achados, todos usados (D-63). `ausente`:
     * nenhum — pede o officer. `sem_raid`: o officer declarou que não houve raid
     * oficial (D-60).
     */
    resolution: z.enum(['automatica', 'ausente', 'sem_raid']),
    /** Os reports usados, com a referência congelada no Auditar. */
    reports: z.array(reportDaAuditoriaSchema),
    motivoSemRaid: z.string().nullable(),
    resolvedByBattletag: z.string().nullable(),
    resolvedAt: z.string().datetime().nullable(),
  })
  .strict();

/** A tentativa corrente de Auditar da rodada — a última não substituída. */
export const auditoriaCorrenteSchema = z
  .object({
    auditId: z.string(),
    attempt: z.number().int().positive(),
    status: z.enum(['aguardando_revisao', 'pronta', 'calculada', 'confirmada']),
    startedByBattletag: z.string(),
    startedAt: z.string().datetime(),
    fontes: z.array(fonteDaAuditoriaSchema),
  })
  .strict();
export type AuditoriaCorrente = z.infer<typeof auditoriaCorrenteSchema>;

/** "Não houve raid oficial nesta sessão" (D-60): o motivo é obrigatório. */
export const declararSemRaidSchema = z.object({ motivo: z.string().trim().min(1) }).strict();
export type DeclararSemRaid = z.infer<typeof declararSemRaidSchema>;
