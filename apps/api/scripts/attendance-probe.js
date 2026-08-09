/**
 * Roda a ingestão de presença à mão, contra as APIs reais.
 *
 * Uso:
 *   pnpm --filter api probe:attendance              # últimos 30 dias
 *   pnpm --filter api probe:attendance --all        # histórico inteiro (2024+)
 *   pnpm --filter api probe:attendance --dias 90
 *
 * O job de verdade é o `@Cron` do AttendanceService. Esta sonda existe porque a
 * rodada só acontece uma vez por dia, e porque o backfill do histórico é uma
 * operação manual — não faz sentido rodar 158 noites toda madrugada.
 *
 * Exige o `dist` compilado (`pnpm --filter api build`) e o banco de pé.
 */

require('../dist/load-env');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { AttendanceService } = require('../dist/attendance/attendance.service');

function janela() {
  if (process.argv.includes('--all')) return undefined;

  const i = process.argv.indexOf('--dias');
  const dias = i >= 0 && /^\d+$/.test(process.argv[i + 1] || '') ? Number(process.argv[i + 1]) : 30;
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const desde = janela();
    console.log(desde ? `\nJanela: desde ${desde.toISOString().slice(0, 10)}` : '\nJanela: tudo');

    const inicio = Date.now();
    const resultado = await app.get(AttendanceService).sync(desde);

    console.log(`\n=== RESULTADO (${Date.now() - inicio}ms) ===`);
    console.log(JSON.stringify(resultado, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
