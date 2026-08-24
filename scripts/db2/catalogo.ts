/**
 * Busca os itemIds do catálogo real pela rota de ops que já existe
 * (`GET /internal/ops/catalog-item-ids`). É o filtro que torna o `wow.db`
 * (centenas de MB) tratável: filtrar pelos nossos ids devolve algumas
 * centenas de linhas por tabela, contra dezenas de milhares no bruto — ver
 * "O tamanho não é obstáculo" em `docs/db2-do-cliente.md`.
 */
export async function buscarItemIdsDoCatalogo(
  apiBaseUrl: string,
  opsToken: string,
): Promise<number[]> {
  const resposta = await fetch(new URL('/internal/ops/catalog-item-ids', apiBaseUrl), {
    headers: { 'X-Ops-Token': opsToken },
  });

  if (!resposta.ok) {
    throw new Error(
      `catalog-item-ids devolveu ${resposta.status}: ${await resposta.text()}. ` +
        'A API precisa estar rodando (pnpm dev:api) com OPS_TRIGGER_TOKEN configurado.',
    );
  }

  const corpo = (await resposta.json()) as { total: number; itemIds: number[] };
  return corpo.itemIds;
}
