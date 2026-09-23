import { z } from 'zod';

/**
 * Titan Bet — Auditar no Officer Panel (D-25, D-30; spec §7.2).
 *
 * Lado de officer: fontes, candidatos e a escolha. Não carrega aposta nenhuma.
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
    /** `ausente` e `ambigua` param a auditoria e pedem o officer (D-24, D-25). */
    resolution: z.enum(['automatica', 'escolha_officer', 'ausente', 'ambigua']),
    report: reportDaAuditoriaSchema.nullable(),
    candidatos: z.array(reportDaAuditoriaSchema),
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

/** A escolha do officer numa sessão ambígua (D-25): um dos candidatos. */
export const escolherFonteSchema = z.object({ reportCode: z.string().min(1) }).strict();
export type EscolherFonte = z.infer<typeof escolherFonteSchema>;
