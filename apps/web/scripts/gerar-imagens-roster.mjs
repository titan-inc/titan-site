import { readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const diretorio = join(raiz, 'public', 'roster');
const destino = join(raiz, 'lib', 'roster', 'imagens-geradas.ts');
const arquivos = (await readdir(diretorio, { withFileTypes: true }))
  .filter((entrada) => entrada.isFile() && /\.(?:avif|gif|jpe?g|png|webp)$/i.test(entrada.name))
  .map((entrada) => entrada.name)
  .sort();

// Emitido já no formato do Prettier, um item por linha com aspas simples e
// vírgula final. O arquivo é versionado — `JSON.stringify` em uma linha só
// passava no `format:check` do CI (que roda antes do build) mas sujava a
// árvore de quem rodasse `pnpm build` localmente.
const corpo = arquivos.length ? `[\n${arquivos.map((nome) => `  '${nome}',`).join('\n')}\n]` : '[]';

await writeFile(
  destino,
  `// Gerado por scripts/gerar-imagens-roster.mjs durante o prebuild.\nexport const imagensRoster: readonly string[] = ${corpo};\n`,
);
