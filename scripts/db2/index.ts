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
import fs from 'node:fs';
import { abrirWowExportDb } from './wow-export-db.js';
import { lerGameTables } from './game-tables.js';
import { buscarItemIdsDoCatalogo } from './catalogo.js';
import { carregarOpsTokenDoEnv } from './ambiente.js';
import { lerArgs } from './cli.js';
import { resolverArvoreDeBonus } from './resolucao-bonus.js';
import { montarEscalasPorIlvl, montarTabelaEscalas } from './montar-escalas.js';
import { rodarAutoConferencia } from './auto-conferencia.js';
import { ResolvedorItemLevel } from './item-level.js';
import { ResolvedorTrack } from './formula-track.js';
import { ResolvedorEfeito } from './formula-efeito.js';
import { montarItens, montarBonuses, montarContextos, montarSets } from './montar-tabelas.js';
import { listarTypesDesconhecidos, imprimirRelatorio } from './relatorio.js';
import {
  carregarItemSparse,
  carregarMaterialPorItem,
  carregarArmorLocation,
  carregarStatsAdicionaisPorBonus,
  carregarQualidadeExtraPorBonus,
  carregarBonusComSocket,
  carregarBindingPorBonus,
  carregarDescritorPorBonus,
  carregarTodosBonusIds,
  carregarConjuntos,
} from './carregadores.js';
import { wowDataFileSchema, WOW_DATA_FILE_VERSION } from '../../packages/shared/dist/index.mjs';

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

  const arvore = resolverArvoreDeBonus(db, itemIdsCatalogo);
  console.log(
    `árvore de bônus: ${arvore.contextosPorItem.size} itens do catálogo têm árvore, ` +
      `${arvore.bonusIdsAlcancados.size} bonusIds alcançados`,
  );

  const escalasPorIlvl = montarEscalasPorIlvl(db, gameTables);
  console.log(`escalas: ${escalasPorIlvl.size} linhas de item level`);

  console.log('\n--- auto-conferência ---');
  const conferencia = rodarAutoConferencia(db, escalasPorIlvl, CAMINHO_FIXTURE);
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

  // --- montagem final ---
  const itemSparsePorId = carregarItemSparse(db, itemIdsCatalogo);
  const materialPorItem = carregarMaterialPorItem(db, itemIdsCatalogo);
  const armorLocationPorSlot = carregarArmorLocation(db);
  const efeitoResolver = new ResolvedorEfeito(db);

  // Todo bonusId do build, não só os que a árvore alcança — ver o
  // comentário de carregarTodosBonusIds. "Ausente da tabela" precisa
  // significar "não existe neste build", nunca "a árvore não ofereceu".
  const todosBonusIds = carregarTodosBonusIds(db);
  console.log(
    `bonus ids no build: ${todosBonusIds.size} (${arvore.bonusIdsAlcancados.size} alcançados pela árvore)`,
  );

  const { tabela: itens, itemIdsSemDado } = montarItens(
    itemIdsCatalogo,
    itemSparsePorId,
    materialPorItem,
    armorLocationPorSlot,
    efeitoResolver,
  );

  const bonuses = montarBonuses(todosBonusIds, {
    itemLevelResolver: new ResolvedorItemLevel(db),
    trackResolver: new ResolvedorTrack(db),
    statsExtrasPorBonus: carregarStatsAdicionaisPorBonus(db),
    qualidadeExtraPorBonus: carregarQualidadeExtraPorBonus(db),
    bonusComSocket: carregarBonusComSocket(db),
    bindingPorBonus: carregarBindingPorBonus(db),
    descritorPorBonus: carregarDescritorPorBonus(db),
  });

  const contextos = montarContextos(arvore.contextosPorItem);
  const escalas = montarTabelaEscalas(escalasPorIlvl);

  // Só os conjuntos que os itens do catálogo alcançam — o `ItemSet` tem 1.008
  // linhas no build e a nossa fatia é minúscula (9 itens, 3 conjuntos).
  const itemSetIds = [
    ...new Set(
      [...itemSparsePorId.values()].map((i) => i.itemSet).filter((id): id is number => id !== 0),
    ),
  ];
  const sets = montarSets(carregarConjuntos(db, itemSetIds));
  console.log(`sets: ${sets.rows.length} conjunto(s) alcançado(s) pelo catálogo`);

  const arquivo = {
    version: WOW_DATA_FILE_VERSION,
    build: args.build,
    itens,
    bonuses,
    contextos,
    escalas,
    sets,
  };

  const validacao = wowDataFileSchema.safeParse(arquivo);
  if (!validacao.success) {
    console.error(
      '\narquivo montado NÃO valida contra wowDataFileSchema — bug do gerador, NÃO emitido:',
    );
    console.error(validacao.error.format());
    db.close();
    process.exitCode = 1;
    return;
  }

  const conteudo = JSON.stringify(validacao.data);
  fs.writeFileSync(args.arquivoSaida, conteudo);

  imprimirRelatorio({
    itemIdsSemDado,
    // Escaneia os MESMOS bonus ids que foram pra bonuses — senão o relatório
    // ficaria cego pra Type desconhecido nos 96% que a árvore não alcança,
    // que é exatamente o que o ponto 1 desta revisão corrigiu.
    typesDesconhecidos: listarTypesDesconhecidos(db, todosBonusIds),
    avisosItemLevelSelector: arvore.avisosItemLevelSelector.length,
    tamanhoBytes: Buffer.byteLength(conteudo),
  });

  console.log(`\nescrito: ${args.arquivoSaida}`);

  db.close();
}

main().catch((erro: unknown) => {
  console.error(erro);
  process.exitCode = 1;
});
