import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

/**
 * Abre o `wow.db` que já mora em `localdocs/wow.export/` — SQLite carregado
 * a partir dos 41 `.sql` do wow.export pelo procedimento de
 * "Como analisar: banco local, descartável" em `docs/db2-do-cliente.md`.
 *
 * O gerador NUNCA reprocessa os `.sql`: o dump já virou banco antes de o
 * gerador rodar. Só leitura — `readOnly` evita qualquer escrita acidental
 * num arquivo que é dado extraído do cliente, fora do alcance do git.
 */
export function abrirWowExportDb(pastaWowExport: string): DatabaseSync {
  const caminho = path.join(pastaWowExport, 'wow.db');
  return new DatabaseSync(caminho, { readOnly: true });
}

/**
 * Campo array de db2 sai do wow.export como string separada por vírgula
 * (`"0,8192,0,0,0"`), nunca como array de verdade — é assim que o dump SQL
 * representa `StatModifier_bonusStat`, `Flags`, `EpicF` etc. Todo lugar que
 * lê um desses campos passa por aqui, para não reimplementar o split.
 */
export function paraArrayNumerico(bruto: string): number[] {
  return bruto.split(',').map(Number);
}
