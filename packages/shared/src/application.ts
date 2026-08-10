import { z } from 'zod';

/**
 * Contrato da candidatura (apply).
 *
 * PROVISÓRIO — os campos precisam ser revisados por quem realmente recruta na
 * guilda antes de ampliar este contrato. Ver TIT-13.
 *
 * Este schema é a única fonte de verdade: o Nest valida com ele no
 * ZodValidationPipe e o form do Next infere os tipos dele. Não redeclarar
 * esses campos em nenhum dos apps.
 */
export const createApplicationSchema = z.object({
  characterRealm: z.string().min(2).max(80),
  roleSpec: z.string().min(2).max(80),
  contact: z.string().min(2).max(100),
  additionalInfo: z.string().max(2000).optional(),

  /**
   * Honeypot anti-spam: o schema aceita o valor para não revelar o campo-armadilha
   * nos erros de validação. O descarte silencioso acontece no serviço da API.
   */
  website: z.string().optional(),
});
export type CreateApplication = z.infer<typeof createApplicationSchema>;

/** Resultado do envio. `delivered` só é true se o Discord aceitou a mensagem. */
export const applyResultSchema = z.object({ delivered: z.literal(true) });
export type ApplyResult = z.infer<typeof applyResultSchema>;
