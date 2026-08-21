import fs from 'node:fs';

/**
 * Carrega `docs/db2-fixture-de-itens.json` e achata os espécimes — alguns
 * vêm com `ranks: [...]` (a track inteira, ex. Steelbark Shoulderguards) em
 * vez de um `itemString`/`esperado` direto. O formato do arquivo é fato
 * observado, não schema nosso — este módulo só normaliza a leitura.
 */

export interface TrackEsperado {
  nome: string;
  rank: number;
  total: number;
}

export interface EspecimeFixture {
  nome: string;
  itemId: number;
  itemString: string;
  itemContext: number;
  bonusIds: number[];
  itemLevelEsperado: number;
  contaminado: boolean;
  /** Cru — o comparador de cada checkpoint decide quais chaves usar. */
  esperado: Record<string, unknown>;
  track?: TrackEsperado;
}

export function carregarFixture(caminho: string): EspecimeFixture[] {
  const bruto = JSON.parse(fs.readFileSync(caminho, 'utf8')) as {
    itens: RawItem[];
  };

  const especimes: EspecimeFixture[] = [];
  for (const item of bruto.itens) {
    if (item.ranks) {
      for (const rank of item.ranks) {
        especimes.push(
          normalizar(
            item.nome,
            item.itemId,
            rank.itemString,
            rank.itemLevel,
            rank.esperado,
            false,
            rank.track,
          ),
        );
      }
    } else if (item.itemString) {
      especimes.push(
        normalizar(
          item.nome,
          item.itemId,
          item.itemString,
          item.itemLevel!,
          item.esperado!,
          item.CONTAMINADO ?? false,
          item.track,
        ),
      );
    }
  }
  return especimes;
}

interface RawItem {
  nome: string;
  itemId: number;
  itemString?: string;
  itemLevel?: number;
  esperado?: Record<string, unknown>;
  CONTAMINADO?: boolean;
  track?: TrackEsperado;
  ranks?: Array<{
    itemString: string;
    itemLevel: number;
    esperado: Record<string, unknown>;
    track?: TrackEsperado;
  }>;
}

function normalizar(
  nome: string,
  itemId: number,
  itemString: string,
  itemLevelEsperado: number,
  esperado: Record<string, unknown>,
  contaminado: boolean,
  track: TrackEsperado | undefined,
): EspecimeFixture {
  const { itemContext, bonusIds } = parsearItemString(itemString);
  return {
    nome,
    itemId,
    itemString,
    itemContext,
    bonusIds,
    itemLevelEsperado,
    contaminado,
    esperado,
    track,
  };
}

/**
 * `item:itemID:enchant:gema1:gema2:gema3:gema4:suffix:playerLevel:upgradeValue:reforge:
 *  itemContext:numBonusIDs:bonus1:...:bonusN:numModificadores:...`
 *
 * Confirmado campo a campo (via `String.split(':')`, não contagem manual —
 * a primeira tentativa contou os `::::::::` errado por um) contra os três
 * exemplos anotados de `docs/db2-do-cliente.md`: índice 12 é o
 * `itemContext`, 13 é a contagem de bônus, e os bônus começam no 14.
 */
function parsearItemString(itemString: string): { itemContext: number; bonusIds: number[] } {
  const campos = itemString.split(':');
  const itemContext = Number(campos[12] ?? 0);
  const numBonusIds = Number(campos[13] ?? 0);
  const bonusIds = campos.slice(14, 14 + numBonusIds).map(Number);
  return { itemContext, bonusIds };
}
