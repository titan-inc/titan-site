import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { resolverUrlDeTeste } from './guarda';

/**
 * Aponta o processo para o `titan_test` — e só para ele.
 *
 * Lê o `.env` da raiz **sem carregá-lo** (`parse`, não `config`): o
 * `DATABASE_URL` de dev nunca chega ao `process.env`. Depois da guarda, grava a
 * URL de teste em `process.env.DATABASE_URL`. Como o `dotenv` não sobrescreve
 * variável que já existe, o `load-env.ts` do app e o `prisma.config.ts` do CLI
 * passam a enxergar o banco de teste sem mudar uma linha deles.
 *
 * Roda antes de qualquer import que construa um `PrismaService`.
 */
export function prepararAmbienteDeTeste(): string {
  const raizEnv = path.resolve(__dirname, '../../../../.env');
  let doArquivo: Record<string, string> = {};
  try {
    doArquivo = parse(readFileSync(raizEnv));
  } catch {
    // Sem .env (CI): a URL de teste tem de vir do ambiente.
  }

  const url = resolverUrlDeTeste({
    testDatabaseUrl: process.env.TEST_DATABASE_URL ?? doArquivo.TEST_DATABASE_URL,
    devDatabaseUrl: doArquivo.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
  });

  process.env.DATABASE_URL = url;
  return url;
}
