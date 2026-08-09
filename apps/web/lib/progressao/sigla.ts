/**
 * Siglas de raid e dificuldade para a régua da navbar.
 *
 * O nome inteiro nunca coube: a régua vive entre o wordmark e o menu, e
 * "Complexo Meridian · Mítico" truncava em "Complexo Merid…" — que não informa
 * nada e ainda parece defeito. Jogador escreve progressão como `6/8 M`, e é
 * essa forma que a barra passa a usar.
 *
 * O nome completo não se perde: continua no painel do mobile, no `title` e na
 * descrição do leitor de tela.
 */

/**
 * Siglas que a comunidade usa e que a derivação automática não acerta.
 *
 * A derivação resolve a maioria ("Complexo Meridian" → `CM`), mas algumas raids
 * têm sigla consagrada que não sai das iniciais. Quando aparecer uma assim,
 * acrescente aqui — a chave é o nome como a fonte de dados escreve, normalizado
 * em minúsculas. Exemplo de forma:
 *
 * ```ts
 * const SIGLAS: Record<string, string> = { 'nome da raid': 'SIGLA' };
 * ```
 *
 * Mantido vazio de propósito: sigla errada é pior que sigla derivada, e
 * inventar uma que a guilda não usa só gera dúvida.
 */
const SIGLAS: Record<string, string> = {};

/** Palavras que não entram na sigla. */
const VAZIAS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'o',
  'a',
  'os',
  'as',
  'of',
  'the',
  'and',
  'to',
]);

/**
 * `Complexo Meridian` → `CM`. Palavra única vira as três primeiras letras
 * (`Ulduar` → `ULD`), porque uma letra sozinha não identifica nada.
 *
 * Teto de 4 caracteres: acima disso volta a não caber, que é o problema que
 * esta função existe para resolver.
 */
export function siglaRaid(nome: string): string {
  const limpo = nome.trim();
  if (!limpo) return '';

  const mapeada = SIGLAS[limpo.toLowerCase()];
  if (mapeada) return mapeada;

  const palavras = limpo
    .split(/[\s\-–—:]+/)
    .map((palavra) => palavra.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((palavra) => palavra.length > 0 && !VAZIAS.has(palavra.toLowerCase()));

  if (palavras.length === 0) return limpo.slice(0, 3).toLocaleUpperCase('pt-BR');
  if (palavras.length === 1) return palavras[0].slice(0, 3).toLocaleUpperCase('pt-BR');

  return palavras
    .map((palavra) => palavra[0])
    .join('')
    .slice(0, 4)
    .toLocaleUpperCase('pt-BR');
}

/**
 * `Mythic` → `M`, `Heroic` → `H`, `Normal` → `N`, `Raid Finder` → `LFR`.
 *
 * Aceita as formas em português porque `resumirProgressaoNav` traduz `Mythic`
 * para `Mítico` quando o dado é de desenvolvimento.
 */
export function siglaDificuldade(nome: string): string {
  const limpo = nome.trim().toLowerCase();
  if (!limpo) return '';
  if (limpo.startsWith('myth') || limpo.startsWith('mít') || limpo.startsWith('mit')) return 'M';
  if (limpo.startsWith('hero')) return 'H';
  if (limpo.startsWith('norm')) return 'N';
  if (limpo.includes('finder') || limpo === 'lfr' || limpo.includes('procura')) return 'LFR';
  return limpo.slice(0, 1).toLocaleUpperCase('pt-BR');
}
