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
import { abrirWowExportDb } from './wow-export-db.js';
import { lerGameTables } from './game-tables.js';
import { buscarItemIdsDoCatalogo } from './catalogo.js';
import { carregarOpsTokenDoEnv } from './ambiente.js';
import { lerArgs } from './cli.js';
import { resolverArvoreDeBonus } from './resolucao-bonus.js';
import { montarEscalasPorIlvl } from './montar-escalas.js';
import { rodarAutoConferencia } from './auto-conferencia.js';

const CAMINHO_FIXTURE = 'docs/db2-fixture-de-itens.json';

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

  const arvore = resolverArvoreDeBonus(db, itemIdsCatalogo);
  console.log(
    `árvore de bônus: ${arvore.contextosPorItem.size} itens do catálogo têm árvore, ` +
      `${arvore.bonusIdsAlcancados.size} bonusIds alcançados`,
  );
  if (arvore.avisosItemLevelSelector.length > 0) {
    console.log(
      `aviso: ${arvore.avisosItemLevelSelector.length} nós aplicados carregam ` +
        'ChildItemLevelSelectorID, não resolvido (ver docs/db2-do-cliente.md)',
    );
  }

  const escalas = montarEscalasPorIlvl(db, gameTables);
  console.log(`escalas: ${escalas.size} linhas de item level`);

  console.log('\n--- auto-conferência ---');
  const conferencia = rodarAutoConferencia(db, escalas, CAMINHO_FIXTURE);
  if (conferencia.divergencias.length > 0) {
    console.error(
      `${conferencia.divergencias.length} divergência(s) contra a fixture — arquivo NÃO emitido:\n`,
    );
    for (const d of conferencia.divergencias) {
      console.error(
        `  [${d.especime}] ${d.campo}: esperado=${String(d.esperado)} calculado=${String(d.calculado)}`,
      );
    }
    db.close();
    process.exitCode = 1;
    return;
  }
  console.log(
    `fixture fechou: ${conferencia.valoresConferidos} valores conferidos, 0 divergências`,
  );

  db.close();
}

main().catch((erro: unknown) => {
  console.error(erro);
  process.exitCode = 1;
});
