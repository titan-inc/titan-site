import fs from 'node:fs';
import path from 'node:path';

/**
 * As três tabelas que NÃO são db2: ficam na aba `Text` do wow.export, saem
 * como `.txt` separado por tab, uma linha por item level com cabeçalho. Ver
 * "Duas abas diferentes: Data e Text" em `docs/db2-do-cliente.md` — procurar
 * por esses nomes na aba `Data` não encontra nada.
 */
export interface MultiplicadorPorTipo {
  armor: number;
  weapon: number;
  trinket: number;
  jewelry: number;
}

export interface GameTables {
  /** `CombatRatingsMultByILvl[ilvl][tipo]` — multiplica secundários. */
  combatRatingsMultByILvl: Map<number, MultiplicadorPorTipo>;
  /** `StaminaMultByILvl[ilvl][tipo]` — mesma forma da tabela acima. */
  staminaMultByILvl: Map<number, MultiplicadorPorTipo>;
  /** `ItemSocketCostPerLevel[ilvl]` — termo morto acima do ilvl 60, mas lido igual. */
  itemSocketCostPerLevel: Map<number, number>;
}

export function lerGameTables(pastaWowExport: string): GameTables {
  return {
    combatRatingsMultByILvl: lerMultiplicadorPorTipo(pastaWowExport, 'CombatRatingsMultByILvl.txt'),
    staminaMultByILvl: lerMultiplicadorPorTipo(pastaWowExport, 'StaminaMultByILvl.txt'),
    itemSocketCostPerLevel: lerColunaUnica(pastaWowExport, 'ItemSocketCostPerLevel.txt'),
  };
}

function linhasDoArquivo(pastaWowExport: string, arquivo: string): string[][] {
  const bruto = fs.readFileSync(path.join(pastaWowExport, arquivo), 'utf8');
  const linhas = bruto.split(/\r?\n/).filter((linha) => linha.length > 0);
  // A primeira linha é cabeçalho (nomes de coluna); os dados começam na segunda.
  return linhas.slice(1).map((linha) => linha.split('\t'));
}

/** Formato comum a `CombatRatingsMultByILvl` e `StaminaMultByILvl`: 4 colunas por tipo. */
function lerMultiplicadorPorTipo(
  pastaWowExport: string,
  arquivo: string,
): Map<number, MultiplicadorPorTipo> {
  const tabela = new Map<number, MultiplicadorPorTipo>();
  for (const [ilvl, armor, weapon, trinket, jewelry] of linhasDoArquivo(pastaWowExport, arquivo)) {
    tabela.set(Number(ilvl), {
      armor: Number(armor),
      weapon: Number(weapon),
      trinket: Number(trinket),
      jewelry: Number(jewelry),
    });
  }
  return tabela;
}

/** Formato de `ItemSocketCostPerLevel`: um valor só por item level. */
function lerColunaUnica(pastaWowExport: string, arquivo: string): Map<number, number> {
  const tabela = new Map<number, number>();
  for (const [ilvl, valor] of linhasDoArquivo(pastaWowExport, arquivo)) {
    tabela.set(Number(ilvl), Number(valor));
  }
  return tabela;
}
