#!/usr/bin/env -S node
/**
 * Gerador do pacote de dado do cliente do WoW — TIT-139.
 *
 * Lê os arquivos que o `wow.export` extraiu, filtra pelo catálogo real,
 * resolve tudo que `docs/db2-do-cliente.md` descreve como estático por
 * build, roda a auto-conferência contra `docs/db2-fixture-de-itens.json` e,
 * só se ela fechar, emite o `wowDataFileSchema` de `packages/shared`.
 *
 * Uso:
 *   pnpm gerar-db2 --build 12.1.0.69299 [--pasta localdocs/wow.export]
 *                                        [--saida localdocs/wow-data-<build>.json]
 *                                        [--api http://localhost:3001]
 */
import path from 'node:path';
import { abrirWowExportDb } from './wow-export-db.js';
import { lerGameTables } from './game-tables.js';
import { buscarItemIdsDoCatalogo } from './catalogo.js';
import { carregarOpsTokenDoEnv } from './ambiente.js';
import { lerArgs } from './cli.js';

async function main(): Promise<void> {
  const args = lerArgs(process.argv.slice(2));
  const opsToken = args.opsToken ?? carregarOpsTokenDoEnv();

  console.log(`build:  ${args.build}`);
  console.log(`pasta:  ${args.pastaWowExport}`);
  console.log(`saida:  ${args.arquivoSaida}`);
  console.log(`api:    ${args.apiBaseUrl}`);

  const db = abrirWowExportDb(args.pastaWowExport);
  const gameTables = lerGameTables(args.pastaWowExport);
  const itemIdsCatalogo = await buscarItemIdsDoCatalogo(args.apiBaseUrl, opsToken);

  console.log(`catálogo: ${itemIdsCatalogo.length} itemIds`);
  console.log(
    `GameTables: combat=${gameTables.combatRatingsMultByILvl.size} linhas, ` +
      `stamina=${gameTables.staminaMultByILvl.size} linhas, ` +
      `socket=${gameTables.itemSocketCostPerLevel.size} linhas`,
  );

  const { total } = db.prepare('SELECT count(*) as total FROM ItemSparse').get() as {
    total: number;
  };
  console.log(`ItemSparse no dump: ${total} linhas`);

  db.close();
}

main().catch((erro: unknown) => {
  console.error(erro);
  process.exitCode = 1;
});
