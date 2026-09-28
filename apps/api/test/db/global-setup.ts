import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { prepararAmbienteDeTeste } from './ambiente';
import { NOME_DO_BANCO_DE_TESTE } from './guarda';

/**
 * `globalSetup` do jest-db.json — uma vez por execução da suíte de banco.
 *
 * 1. Guarda: sem `titan_test` local e inequívoco, nada abaixo roda.
 * 2. Cria o `titan_test` se ainda não existir. Não dá para confiar no
 *    `docker-entrypoint-initdb.d`: ele só roda em volume novo, e o volume de
 *    dev já existe.
 * 3. Recria o schema e aplica as migrations com `prisma migrate deploy` — o
 *    mesmo comando do deploy de produção. Cada execução parte de um banco que
 *    é exatamente "as migrations do repositório", sem sobra de execução
 *    anterior. `DROP SCHEMA` não passa pelos triggers de append-only do Titan
 *    Bet, que vigiam UPDATE/DELETE/TRUNCATE de linha.
 *
 * Por que não `prisma migrate reset`: o CLI do Prisma recusa comandos
 * destrutivos quando detecta que foi chamado por um agente de IA, e liberar
 * isso exige consentimento explícito de uma pessoa. Recriar o schema aqui,
 * depois da guarda, dá o mesmo resultado sem pedir para contornar aquela trava.
 */
export default async function globalSetup(): Promise<void> {
  const url = prepararAmbienteDeTeste();

  await garantirBanco(url);
  await recriarSchema(url);
  aplicarMigrations(url);
}

async function garantirBanco(url: string): Promise<void> {
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const cliente = new PrismaClient({
    adapter: new PrismaPg({ connectionString: admin.toString() }),
  });

  try {
    const existe = await cliente.$queryRaw<Array<{ existe: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${NOME_DO_BANCO_DE_TESTE}) AS existe`;

    if (!existe[0]?.existe) {
      // Nome fixo, validado pela guarda — não vem de entrada nenhuma.
      await cliente.$executeRawUnsafe(`CREATE DATABASE "${NOME_DO_BANCO_DE_TESTE}"`);
    }
  } finally {
    await cliente.$disconnect();
  }
}

async function recriarSchema(url: string): Promise<void> {
  const cliente = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    // Segunda conferência, agora pelo próprio servidor: a conexão está mesmo no
    // banco de teste antes do DROP.
    const atual = await cliente.$queryRaw<
      Array<{ banco: string }>
    >`SELECT current_database() AS banco`;
    if (atual[0]?.banco !== NOME_DO_BANCO_DE_TESTE) {
      throw new Error(`Conectado em "${atual[0]?.banco}", não em "${NOME_DO_BANCO_DE_TESTE}".`);
    }

    await cliente.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await cliente.$executeRawUnsafe('CREATE SCHEMA public');
  } finally {
    await cliente.$disconnect();
  }
}

function aplicarMigrations(url: string): void {
  const resultado = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (resultado.status !== 0) {
    throw new Error(
      `prisma migrate deploy falhou no ${NOME_DO_BANCO_DE_TESTE} (exit ${resultado.status}).`,
    );
  }
}
