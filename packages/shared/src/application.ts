import { z } from 'zod';

/**
 * Contrato da candidatura (apply).
 *
 * PROVISÓRIO — os campos precisam ser revisados por quem realmente recruta na
 * guilda antes de virar migration definitiva. Ver TIT-13.
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
   * Honeypot anti-spam: campo escondido no form. Humano deixa vazio; bot que
   * preenche tudo cai aqui. Ver TIT-14.
   */
  website: z.string().max(0).optional(),
});
export type CreateApplication = z.infer<typeof createApplicationSchema>;

export const APPLICATION_STATUSES = ['pending', 'reviewing', 'accepted', 'rejected'] as const;
export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;
