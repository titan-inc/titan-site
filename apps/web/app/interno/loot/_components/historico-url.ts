/**
 * Token de "todas as seasons" na URL do histórico.
 *
 * A API entende **ausência** de `season` como "todas", mas a tela não pode usar
 * ausência para isso: ausência é também o estado da primeira visita, que vira a
 * season mais recente. Um token explícito separa "ainda não escolhi" de
 * "escolhi ver tudo".
 *
 * ## Por que este arquivo existe, e não é uma const no componente
 *
 * Ele nasceu dentro de `filtros-historico.tsx`, que é `'use client'`. Quando um
 * **server component** importa um valor de um módulo cliente, o que chega não é
 * o valor: é uma referência de cliente. A comparação `busca.season === TODAS`
 * era sempre falsa, o token vazava para a query da API, e a resposta era 400 —
 * a tela mostrava "não foi possível carregar" sem nenhum erro no console do
 * servidor.
 *
 * Constante compartilhada entre servidor e cliente mora num módulo **sem**
 * `'use client'`, e é por isso que este arquivo é separado.
 */
export const TODAS_AS_SEASONS = 'todas';

/** Os filtros que a tela entende. Qualquer outro parâmetro na URL é ignorado. */
export interface BuscaHistorico {
  season?: string;
  character?: string;
  encounterId?: string;
  difficulty?: string;
  slot?: string;
  page?: string;
}

/**
 * A season que a API deve receber, a partir do que está na URL.
 *
 * `undefined` cobre dois casos que a API trata igual — "todas" e "ainda não
 * escolhi" — mas que a tela distingue: o segundo vira redirect para a season
 * mais recente.
 */
export function seasonParaApi(bruto: string | undefined): string | undefined {
  return bruto === TODAS_AS_SEASONS ? undefined : bruto;
}

/**
 * Os filtros da URL viram query da API.
 *
 * A `season` entra resolvida de fora, e **não** sai de `busca`: em "todas as
 * seasons" ela é `undefined` de propósito, enquanto `busca.season` ainda tem o
 * token da tela. Mandar o token para a API devolve 400 — foi assim que este
 * caminho quebrou a primeira vez, e a tela só dizia "não foi possível carregar".
 */
export function filtrosDaApi(
  busca: BuscaHistorico,
  season: string | undefined,
): Record<string, string> {
  const candidatos: Array<[string, string | undefined]> = [
    ['season', season],
    ['character', busca.character],
    ['encounterId', busca.encounterId],
    ['difficulty', busca.difficulty],
    ['slot', busca.slot],
    ['page', busca.page],
  ];

  const filtros: Record<string, string> = {};
  for (const [chave, valor] of candidatos) {
    // Vazio é omitido: `?character=` é o que um `<select>` sem seleção manda, e
    // repassar isso faria a API recusar o request inteiro.
    if (valor !== undefined && valor !== '') filtros[chave] = valor;
  }

  return filtros;
}
