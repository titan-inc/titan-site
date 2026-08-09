/**
 * Gera o arquivo de catálogo de uma raid, a partir da Blizzard e do Warcraft
 * Logs, para o humano revisar em vez de digitar.
 *
 * Uso:
 *   pnpm --filter api catalog:generate --lista            # 25 mais recentes
 *   pnpm --filter api catalog:generate --lista voidspire  # filtra por nome
 *   pnpm --filter api catalog:generate 1307 --saida catalogo/the-voidspire.json
 *   pnpm --filter api catalog:generate 1307 --slug outro --saida x.json
 *
 * O `journalInstanceId` é o id do Encounter Journal, que NÃO é o mesmo do jogo
 * nem do WCL — use `--lista` para descobrir o da raid.
 *
 * O que sai preenchido: bosses, ordem, dificuldades, `dungeonEncounterId`, e por
 * item nome, ícone, slot, subclasse e stats primários.
 *
 * O que sobra para a mão: `usableBySpecs`. É curadoria que depende do efeito do
 * item e não sai de API nenhuma — trinket com intelecto e proc de cura serve
 * healer e não serve mago, e nenhum campo da Blizzard diz isso.
 *
 * Exige o `dist` compilado (`pnpm --filter api build`).
 */

require('../dist/load-env');

const fs = require('node:fs');
const path = require('node:path');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { BlizzardService } = require('../dist/blizzard/blizzard.service');
const {
  LootCatalogGeneratorService,
} = require('../dist/loot-catalog/loot-catalog-generator.service');

function valorDe(args, nome) {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * Lista as instâncias do journal, para achar o id.
 *
 * Do id mais alto para o mais baixo porque a raid que interessa é quase sempre a
 * mais nova, e são mais de 200 entradas. Aceita um filtro por nome.
 */
async function listar(app, filtro) {
  const instancias = await app.get(BlizzardService).getJournalInstanceIndex();

  const alvo = filtro
    ? instancias.filter((i) => i.name.toLowerCase().includes(filtro.toLowerCase()))
    : instancias
        .slice()
        .sort((a, b) => b.id - a.id)
        .slice(0, 25);

  console.log(`\n${alvo.length} de ${instancias.length} instância(s):\n`);
  for (const i of alvo) {
    console.log(`  ${String(i.id).padStart(5)}  ${i.name}`);
  }
  console.log('\nUse o id com: pnpm --filter api catalog:generate <id> --saida <arquivo.json>');
}

async function main() {
  const args = process.argv.slice(2);
  const saida = valorDe(args, '--saida');
  const slug = valorDe(args, '--slug');
  const id = args.find((a) => /^\d+$/.test(a));
  const querLista = args.includes('--lista');

  if (querLista) {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['warn', 'error'],
    });
    try {
      await listar(app, valorDe(args, '--lista'));
    } finally {
      await app.close();
    }
    return;
  }

  if (!id) {
    console.error(
      'Uso: pnpm --filter api catalog:generate <journalInstanceId> --saida <arquivo.json> [--slug <slug>]',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const inicio = Date.now();
    const arquivo = await app.get(LootCatalogGeneratorService).gerar(Number(id), slug);
    const duracao = Date.now() - inicio;

    const itens = new Set(arquivo.bosses.flatMap((b) => b.items.map((i) => i.itemId)));
    const semId = arquivo.bosses.filter((b) => b.dungeonEncounterId === undefined);

    const json = `${JSON.stringify(arquivo, null, 2)}\n`;

    if (saida) {
      const destino = path.resolve(process.cwd(), saida);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, json, 'utf8');
      console.log(`\nEscrito em ${destino}`);
    } else {
      console.log(json);
    }

    console.log(`\n=== ${arquivo.name} (${arquivo.slug}) — ${duracao}ms ===`);
    console.log(`  ${arquivo.bosses.length} boss(es)`);
    console.log(`  ${itens.size} item(ns) distintos`);

    if (semId.length > 0) {
      console.log(
        `\nAVISO: ${semId.length} boss(es) sem dungeonEncounterId — o WCL ainda não os conhece.` +
          ` A colagem do addon não vai casar com eles até o id ser preenchido:\n  ` +
          semId.map((b) => b.name).join('\n  '),
      );
    }

    console.log('\nFalta preencher `usableBySpecs` à mão antes de carregar.');
  } finally {
    await app.close();
  }
}

main().catch((erro) => {
  console.error(`\n${erro.message}`);
  process.exitCode = 1;
});
