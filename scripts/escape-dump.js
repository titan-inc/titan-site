#!/usr/bin/env node
'use strict';

/**
 * Escapa um dump cru do addon (`/tilc journal`, colado num .txt) como
 * string JSON, gravando ao lado do arquivo de entrada com extensão .json.
 *
 * Existe porque o Yaak não faz isso sozinho: `json.escape()` não funciona
 * na CLI instalada (testado em 15/08/2026 — devolve o texto sem escapar,
 * sem erro nenhum). `catalog_dump_path`, na collection do Yaak, sempre
 * aponta pro .json gerado aqui, nunca pro .txt cru — colar o dump cru
 * direto no corpo de `internal/ops/catalog-generate` quebra o JSON (ver
 * docs/ops.md e yaak/README.md).
 *
 * Uso: node scripts/escape-dump.js <arquivo.txt> [arquivo-saida.json]
 */

const fs = require('node:fs');

const [, , entrada, saida] = process.argv;

if (!entrada) {
  console.error('Uso: node scripts/escape-dump.js <arquivo.txt> [arquivo-saida.json]');
  process.exit(1);
}

const destino = saida ?? entrada.replace(/\.txt$/i, '') + '.json';

const texto = fs.readFileSync(entrada, 'utf8');
fs.writeFileSync(destino, JSON.stringify(texto));

console.log(`${entrada} -> ${destino}`);
