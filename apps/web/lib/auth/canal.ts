import { z } from 'zod';

/**
 * O canal por onde o popup avisa a janela mãe que o login terminou.
 *
 * `BroadcastChannel`, e não `postMessage` no `window.opener` (TIT-144). Os dois
 * são same-origin, mas o `opener` é uma referência que pode sumir — a janela
 * fecha, o navegador corta o vínculo, a política de alguma página no meio do
 * caminho troca o grupo de contextos. O canal não depende de nenhuma janela
 * continuar existindo: quem estiver ouvindo, ouve.
 *
 * Continua sendo só o caminho **rápido**. Quem garante o fim do login é o
 * polling em `/api/sessao`, porque o canal também pode não chegar — e um aviso
 * que às vezes não chega não pode ser a única forma de saber.
 */
export const CANAL_LOGIN = 'titan-oauth';

export const avisoLoginSchema = z.object({
  tipo: z.literal('titan-oauth'),
  status: z.enum(['ok', 'erro']),
  motivo: z.string().optional(),
});
export type AvisoLogin = z.infer<typeof avisoLoginSchema>;
