/**
 * A guarda do banco de teste — ver `docs/specs/titan-bet-test-design.md` §1.2.
 *
 * Os testes de banco do Titan Bet inserem, violam e recriam o schema inteiro.
 * Rodá-los contra o banco de dev apagaria o dado de quem desenvolve; contra o
 * de produção, o da guilda. Esta função é a única porta: ou devolve uma URL que
 * é, sem ambiguidade, o `titan_test` local, ou lança.
 *
 * Pura de propósito — recebe tudo por parâmetro — para ser testada sem banco e
 * sem depender do `.env` de quem roda.
 */

/** O único nome de banco aceito. Exato: `titan_test_2` também é recusado. */
export const NOME_DO_BANCO_DE_TESTE = 'titan_test';

/** Hosts aceitos. O service container do CI também é `localhost`. */
const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export interface EntradaDaGuarda {
  /** `TEST_DATABASE_URL`, do ambiente ou do `.env`. */
  testDatabaseUrl: string | undefined;
  /** `DATABASE_URL` do `.env` — o banco de dev, que nunca pode ser o alvo. */
  devDatabaseUrl: string | undefined;
  nodeEnv: string | undefined;
}

export function resolverUrlDeTeste(entrada: EntradaDaGuarda): string {
  const bruta = entrada.testDatabaseUrl?.trim();

  if (!bruta) {
    throw new Error(
      'TEST_DATABASE_URL não está definida. Os testes de banco só rodam contra o ' +
        `"${NOME_DO_BANCO_DE_TESTE}" — ver .env.example.`,
    );
  }

  if (entrada.nodeEnv === 'production') {
    throw new Error('Testes de banco recusados: NODE_ENV=production.');
  }

  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    throw new Error('TEST_DATABASE_URL não é uma URL válida.');
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`TEST_DATABASE_URL precisa ser postgresql://, veio "${url.protocol}".`);
  }

  if (!HOSTS_LOCAIS.has(url.hostname)) {
    throw new Error(
      `TEST_DATABASE_URL aponta para "${url.hostname}". Só host local é aceito — ` +
        'banco remoto nunca é banco de teste.',
    );
  }

  const nome = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (nome !== NOME_DO_BANCO_DE_TESTE) {
    throw new Error(
      `TEST_DATABASE_URL aponta para o banco "${nome}". Só "${NOME_DO_BANCO_DE_TESTE}" é aceito.`,
    );
  }

  if (entrada.devDatabaseUrl && mesmoBanco(url, entrada.devDatabaseUrl)) {
    throw new Error('TEST_DATABASE_URL é o mesmo banco do DATABASE_URL de dev.');
  }

  return bruta;
}

/** Host, porta e nome iguais = mesmo banco, qualquer que seja o resto da URL. */
function mesmoBanco(teste: URL, outraBruta: string): boolean {
  let outra: URL;
  try {
    outra = new URL(outraBruta.trim());
  } catch {
    return false;
  }
  const chave = (u: URL) => `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  return chave(teste) === chave(outra);
}
