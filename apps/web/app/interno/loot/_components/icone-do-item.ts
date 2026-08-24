/**
 * URL do ícone a partir do slug do catálogo.
 *
 * O slug é o que fica gravado; a URL se compõe na hora, porque ela é formato de
 * CDN e pode mudar sem que o dado mude.
 */
export function urlDoIcone(icon: string): string {
  return `https://render.worldofwarcraft.com/us/icons/56/${icon}.jpg`;
}
