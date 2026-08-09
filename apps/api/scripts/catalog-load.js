/**
 * Aplica um arquivo de catálogo ao banco.
 *
 * Uso:
 *   pnpm --filter api catalog:load <arquivo.json>
 *   pnpm --filter api catalog:load <arquivo.json> --sem-conferencia
 *
 * O arquivo é a FONTE DA VERDADE: drop que não está nele é removido do banco.
 * Isso é seguro porque histórico e sessão guardam `itemId`, nunca a linha de
 * drop — editar o catálogo não alcança o que já aconteceu.
 *
 * Idempotente: rodar duas vezes atualiza, não duplica.
 *
 * Antes de gravar qualquer coisa, confere cada `dungeonEncounterId` contra o
 * Warcraft Logs. Id errado não quebra nada na hora — o sintoma apareceria
 * semanas depois, como "a colagem do addon não casa com boss nenhum", no meio de
 * uma raid. O `--sem-conferencia` existe só para o caso de o WCL estar fora do
 * ar.
 *
 * Exige o `dist` compilado (`pnpm --filter api build`) e o banco de pé.
 */

require('../dist/load-env');

const fs = require('node:fs');
const path = require('node:path');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { LootCatalogService } = require('../dist/loot-catalog/loot-catalog.service');
const { catalogFileSchema } = require('@titan/shared');

function lerArquivo(caminho) {
  const absoluto = path.resolve(process.cwd(), caminho);

  if (!fs.existsSync(absoluto)) {
    throw new Error(`Arquivo não encontrado: ${absoluto}`);
  }

  // Tira o BOM antes de parsear. Editor no Windows grava UTF-8 com BOM sem
  // avisar, e o `JSON.parse` morre com "Unexpected token '﻿'", que não
  // sugere a causa nem o conserto. Aconteceu duas vezes na construção disto.
  const texto = fs.readFileSync(absoluto, 'utf8').replace(/^﻿/, '');

  try {
    return { absoluto, conteudo: JSON.parse(texto) };
  } catch (erro) {
    throw new Error(`JSON inválido em ${absoluto}:\n  ${erro.message}`);
  }
}

/**
 * Valida com o mesmo schema que o resto do sistema usa — Regra 2.
 *
 * Reporta o caminho de cada campo inválido em vez de um "parse error" cru: o
 * arquivo tem centenas de itens, e "algo está errado" não ajuda ninguém.
 */
function validar(conteudo) {
  const r = catalogFileSchema.safeParse(conteudo);

  if (!r.success) {
    const problemas = r.error.issues
      .map((i) => `  ${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Arquivo inválido:\n${problemas}`);
  }

  return r.data;
}

async function main() {
  const args = process.argv.slice(2);
  const caminho = args.find((a) => !a.startsWith('--'));
  const semConferencia = args.includes('--sem-conferencia');

  if (!caminho) {
    console.error('Uso: pnpm --filter api catalog:load <arquivo.json> [--sem-conferencia]');
    process.exitCode = 1;
    return;
  }

  const { absoluto, conteudo } = lerArquivo(caminho);
  const arquivo = validar(conteudo);

  console.log(`\n=== ${arquivo.name} (${arquivo.slug}) ===`);
  console.log(`arquivo: ${absoluto}`);
  console.log(`bosses:  ${arquivo.bosses.length}`);
  if (semConferencia) {
    console.log('AVISO: conferência contra o Warcraft Logs desligada.');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const inicio = Date.now();
    const r = await app.get(LootCatalogService).carregarArquivo(arquivo, { semConferencia });
    const duracao = Date.now() - inicio;

    console.log(`\nCarregado em ${duracao}ms:`);
    console.log(`  ${r.bosses} boss(es)`);
    console.log(`  ${r.itens} item(ns) no dicionário`);
    console.log(`  ${r.drops} linha(s) de drop`);

    if (r.semDungeonEncounterId.length > 0) {
      console.log(
        `\nAVISO: ${r.semDungeonEncounterId.length} boss(es) sem dungeonEncounterId — a colagem` +
          ` do addon não vai casar com eles:\n  ${r.semDungeonEncounterId.join('\n  ')}`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((erro) => {
  console.error(`\n${erro.message}`);
  process.exitCode = 1;
});
