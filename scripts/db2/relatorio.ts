import type { DatabaseSync } from 'node:sqlite';

/**
 * O relatório final — "o que ainda não conhecemos" (TIT-82) e o tamanho
 * gerado. Nunca falha dura: lacuna e `Type` desconhecido são informação,
 * não motivo pra recusar o arquivo (só a fixture não fechar recusa).
 */

/**
 * Todo `Type` do `ItemBonus` com significado conhecido: o enum do SimC
 * (`item_bonus_type`) — 1..53, ver "O Type do ItemBonus" na doc — mais os
 * achados nossos que o SimC não nomeia: `0` (no-op), `34` (track), `38`
 * (redundante, mas explicado), `46` (vínculo), `51` (SCALE_CONFIG_2).
 *
 * Fora desta lista é o residual "Aberto e conhecido" da doc (hoje `7, 9, 16,
 * 26, 37, 47`) mais qualquer `Type` novo que apareça — os dois casos são
 * "não decodificado", e o relatório não distingue: os dois são matéria-prima
 * pra próxima rodada.
 */
const TYPES_DECODIFICADOS = new Set([
  0, 1, 2, 3, 4, 5, 6, 8, 11, 13, 14, 17, 23, 25, 34, 36, 38, 42, 46, 48, 49, 50, 51, 52, 53,
]);

export interface AvisoTypeDesconhecido {
  type: number;
  ocorrencias: number;
}

export function listarTypesDesconhecidos(
  db: DatabaseSync,
  bonusIds: Set<number>,
): AvisoTypeDesconhecido[] {
  if (bonusIds.size === 0) return [];
  const placeholders = [...bonusIds].map(() => '?').join(',');
  const linhas = db
    .prepare(
      `SELECT Type, count(*) as c FROM ItemBonus WHERE ParentItemBonusListID IN (${placeholders}) GROUP BY Type`,
    )
    .all(...bonusIds) as unknown as Array<{ Type: number; c: number }>;

  return linhas
    .filter((l) => !TYPES_DECODIFICADOS.has(l.Type))
    .map((l) => ({ type: l.Type, ocorrencias: l.c }))
    .sort((a, b) => b.ocorrencias - a.ocorrencias);
}

export function imprimirRelatorio(params: {
  itemIdsSemDado: number[];
  typesDesconhecidos: AvisoTypeDesconhecido[];
  avisosItemLevelSelector: number;
  tamanhoBytes: number;
}): void {
  console.log('\n--- relatório ---');

  if (params.itemIdsSemDado.length === 0) {
    console.log('itens sem dado: nenhum');
  } else {
    console.log(
      `itens sem dado (lacuna — no catálogo, sem linha no ItemSparse): ${params.itemIdsSemDado.length}`,
    );
    console.log(`  ${params.itemIdsSemDado.join(', ')}`);
  }

  if (params.typesDesconhecidos.length === 0) {
    console.log('Type desconhecido alcançado: nenhum');
  } else {
    console.log(`Type desconhecido alcançado (matéria-prima pra próxima rodada de pesquisa):`);
    for (const t of params.typesDesconhecidos) {
      console.log(`  Type ${t.type}: ${t.ocorrencias} ocorrência(s)`);
    }
  }

  if (params.avisosItemLevelSelector > 0) {
    console.log(
      `ChildItemLevelSelectorID não resolvido: ${params.avisosItemLevelSelector} nó(s) aplicado(s)`,
    );
  }

  const kb = params.tamanhoBytes / 1024;
  console.log(`tamanho gerado: ${kb.toFixed(1)} KB`);
}
