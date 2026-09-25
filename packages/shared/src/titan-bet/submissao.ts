import { z } from 'zod';

/**
 * O que o Submeter pagamento congela no slip: depositante, total e horário
 * (D-27). Slip expirado pode **nunca** ter sido submetido — rascunho que chegou
 * ao cutoff (D-71) —, e aí os três vêm nulos, juntos. Nenhum outro estado vem
 * sem eles, e nunca meia submissão: uma data inventada ou um total sem data
 * quebram o parse.
 */
export const camposDaSubmissao = {
  depositCharacter: z.object({ name: z.string(), realm: z.string() }).strict().nullable(),
  expectedTotal: z.number().int().nullable(),
  submittedAt: z.string().datetime().nullable(),
};

export function submissaoCoerente(
  s: {
    status: string;
    depositCharacter: unknown;
    expectedTotal: number | null;
    submittedAt: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  const nulos = [s.depositCharacter, s.expectedTotal, s.submittedAt].filter((v) => v === null);
  if (nulos.length === 0) return;
  if (nulos.length < 3) {
    ctx.addIssue({
      code: 'custom',
      message: 'submissão pela metade: depositante, total e data vêm juntos',
    });
  } else if (s.status !== 'expirado' && s.status !== 'cancelado') {
    // Rascunho que chegou ao cutoff (D-71) ou à rodada cancelada (D-77).
    ctx.addIssue({
      code: 'custom',
      message: 'só slip expirado ou cancelado pode não ter sido submetido (D-71, D-77)',
    });
  }
}
