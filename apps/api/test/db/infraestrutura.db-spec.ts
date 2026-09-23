import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NOME_DO_BANCO_DE_TESTE, resolverUrlDeTeste } from './guarda';

/**
 * Sanidade da infraestrutura do `titan_test` (RED-M2A).
 *
 * **Não é RED funcional do Titan Bet** — ver `titan-bet-test-design.md` §7. Prova
 * três coisas antes de qualquer teste de invariante existir: a guarda recusa
 * tudo que não é o banco de teste local, a conexão da suíte cai no
 * `titan_test`, e o schema dele é exatamente o das migrations do repositório.
 *
 * `PrismaService` instanciado direto — Regra 8: nunca `NestFactory`.
 */

const LOCAL = 'postgresql://titan:titan@localhost:5432';
const DEV = `${LOCAL}/titan?schema=public`;
const TESTE = `${LOCAL}/${NOME_DO_BANCO_DE_TESTE}?schema=public`;

describe('guarda do banco de teste', () => {
  const base = { testDatabaseUrl: TESTE, devDatabaseUrl: DEV, nodeEnv: 'test' };

  it('aceita o titan_test local', () => {
    expect(resolverUrlDeTeste(base)).toBe(TESTE);
  });

  it('recusa quando TEST_DATABASE_URL não existe', () => {
    expect(() => resolverUrlDeTeste({ ...base, testDatabaseUrl: undefined })).toThrow(
      /TEST_DATABASE_URL não está definida/,
    );
    expect(() => resolverUrlDeTeste({ ...base, testDatabaseUrl: '  ' })).toThrow(
      /TEST_DATABASE_URL não está definida/,
    );
  });

  it('recusa o banco de dev, mesmo passado como banco de teste', () => {
    expect(() => resolverUrlDeTeste({ ...base, testDatabaseUrl: DEV })).toThrow(
      /banco "titan"\. Só "titan_test"/,
    );
  });

  it('recusa nome de banco que só se parece com o de teste', () => {
    for (const nome of ['titan_test_2', 'titan_testing', 'TITAN_TEST', 'postgres']) {
      expect(() => resolverUrlDeTeste({ ...base, testDatabaseUrl: `${LOCAL}/${nome}` })).toThrow(
        /Só "titan_test" é aceito/,
      );
    }
  });

  it('recusa host que não é local', () => {
    for (const host of ['db.example.com', '10.0.0.5', 'postgres']) {
      expect(() =>
        resolverUrlDeTeste({
          ...base,
          testDatabaseUrl: `postgresql://titan:titan@${host}:5432/titan_test`,
        }),
      ).toThrow(/Só host local é aceito/);
    }
  });

  it('recusa quando o DATABASE_URL de dev já aponta para o titan_test', () => {
    expect(() => resolverUrlDeTeste({ ...base, devDatabaseUrl: TESTE })).toThrow(
      /mesmo banco do DATABASE_URL de dev/,
    );
  });

  it('recusa NODE_ENV=production', () => {
    expect(() => resolverUrlDeTeste({ ...base, nodeEnv: 'production' })).toThrow(
      /NODE_ENV=production/,
    );
  });

  it('recusa protocolo que não é postgres e URL inválida', () => {
    expect(() =>
      resolverUrlDeTeste({ ...base, testDatabaseUrl: 'mysql://localhost/titan_test' }),
    ).toThrow(/postgresql:\/\//);
    expect(() => resolverUrlDeTeste({ ...base, testDatabaseUrl: 'não é url' })).toThrow(
      /não é uma URL válida/,
    );
  });
});

describe('conexão da suíte de banco', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('o processo aponta para o titan_test, não para o banco de dev', () => {
    expect(new URL(process.env.DATABASE_URL ?? '').pathname).toBe(`/${NOME_DO_BANCO_DE_TESTE}`);
  });

  it('o servidor confirma: a conexão está no titan_test', async () => {
    const [linha] = await prisma.$queryRaw<Array<{ banco: string }>>`
      SELECT current_database() AS banco`;
    expect(linha?.banco).toBe(NOME_DO_BANCO_DE_TESTE);
  });

  it('o schema é exatamente o das migrations do repositório', async () => {
    const pasta = path.resolve(__dirname, '../../prisma/migrations');
    const noRepositorio = readdirSync(pasta)
      .filter((nome) => statSync(path.join(pasta, nome)).isDirectory())
      .sort();

    const aplicadas = await prisma.$queryRaw<Array<{ nome: string }>>`
      SELECT migration_name AS nome FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name`;

    expect(aplicadas.map((m) => m.nome)).toEqual(noRepositorio);
  });
});
