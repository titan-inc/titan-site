/**
 * Monta o relatório de progressão de raid contra o Warcraft Logs real.
 *
 * Uso:
 *   pnpm --filter api probe:raid            # season mais recente gravada
 *   pnpm --filter api probe:raid 17         # uma season específica
 *
 * Existe porque o caminho inteiro (catálogo de zonas → relatórios da guilda →
 * filtro pull a pull → agrupamento por raid) só dá para conferir contra dado
 * de verdade: o que quebra aqui é log misturando raid com dungeon de M+, e isso
 * não aparece em fixture.
 *
 * Exige o `dist` compilado (`pnpm --filter api build`) e o banco de pé — o
 * seletor de season sai do `GameSeason`.
 */

require('../dist/load-env');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { RaidProgressService } = require('../dist/raidprogress/raidprogress.service');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const argumento = process.argv[2];
    const seasonId = argumento && /^\d+$/.test(argumento) ? Number(argumento) : undefined;

    const inicio = Date.now();
    const report = await app.get(RaidProgressService).getReport(seasonId);
    const duracao = Date.now() - inicio;

    if (report === null) {
      console.log('\nNenhuma season gravada ainda — rode o snapshot primeiro.');
      return;
    }

    console.log(`\n=== ${report.season.patch ?? '?'} — ${report.season.name} (${duracao}ms) ===`);
    console.log(
      `dificuldades: ${report.difficulties.map((d) => `${d.id}:${d.name}`).join(', ')}` +
        `${report.stale ? '  [CACHE VELHO]' : ''}`,
    );

    for (const raid of report.raids) {
      const resumo = report.difficulties
        .map((d) => {
          const mortos = raid.bosses.filter((b) =>
            b.byDifficulty.some((x) => x.difficulty === d.id && x.kills > 0),
          ).length;
          return `${mortos}/${raid.bosses.length} ${d.name}`;
        })
        .join('  ');

      console.log(`\n${raid.name}  [${raid.tier}]  ${raid.id === null ? '' : resumo}`);

      for (const boss of raid.bosses) {
        const celulas = report.difficulties.map((d) => {
          const estado = boss.byDifficulty.find((x) => x.difficulty === d.id);
          if (!estado) return '—'.padEnd(22);
          const valor =
            estado.kills > 0
              ? `kill ${estado.firstKillAt.slice(0, 10)}`
              : `melhor ${estado.bestPercent === null ? '?' : `${estado.bestPercent}%`}`;
          return `${valor} (${estado.pulls}p)`.padEnd(22);
        });
        console.log(`  ${boss.name.padEnd(32)} ${celulas.join(' ')}`);
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
