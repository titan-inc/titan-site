/**
 * Config compartilhada entre Server e Client Components.
 *
 * Só valores seguros no browser. NADA de `next/headers` ou segredo aqui — este
 * módulo é importado por client components, e qualquer import server-only faz o
 * build quebrar (foi exatamente o que aconteceu quando API_URL vivia junto das
 * funções que leem cookie).
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Nome do cookie de sessão. Tem que casar com SESSION_COOKIE no Nest. */
export const SESSION_COOKIE = 'titan_session';
export const OAUTH_POPUP_HABILITADO = process.env.NEXT_PUBLIC_OAUTH_POPUP_ENABLED === 'true';
