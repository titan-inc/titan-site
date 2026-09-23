/**
 * O que o banco fez com uma escrita — para os testes de invariante afirmarem a
 * **classe** da recusa, e não "lançou qualquer coisa".
 *
 * Sem isso, um teste de "o banco recusa X" passaria por um erro de fixture (FK
 * para linha que não existe, coluna errada) e a evidência RED/GREEN não diria
 * nada. Aqui, uma escrita aceita vira `'aceito'`, e o RED de um invariante que
 * ainda não existe aparece como `esperado 'unique', recebido 'aceito'`.
 *
 * O SQLSTATE vem de `meta.driverAdapterError.cause.originalCode`, onde o
 * Prisma 7 com `@prisma/adapter-pg` o expõe (medido no RED-M2B).
 */
export type ResultadoDaEscrita = 'aceito' | 'unique' | 'fk' | 'check' | `outro:${string}`;

const POR_SQLSTATE: Record<string, ResultadoDaEscrita> = {
  '23505': 'unique',
  '23503': 'fk',
  '23514': 'check',
};

export async function escrita(operacao: Promise<unknown>): Promise<ResultadoDaEscrita> {
  try {
    await operacao;
    return 'aceito';
  } catch (erro: unknown) {
    const codigo = sqlstate(erro);
    if (codigo && POR_SQLSTATE[codigo]) return POR_SQLSTATE[codigo];
    // Qualquer outra falha é devolvida com o motivo, para o teste mostrar que
    // falhou por outra razão — nunca contada como a recusa esperada.
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return `outro:${codigo ?? ''} ${mensagem.slice(0, 200)}`;
  }
}

function sqlstate(erro: unknown): string | undefined {
  const meta = (erro as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } })
    .meta;
  const codigo = meta?.driverAdapterError?.cause?.originalCode;
  return typeof codigo === 'string' ? codigo : undefined;
}
