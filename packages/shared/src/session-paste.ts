import { splitNomeRealm } from './rc-export.js';
import { RAID_DIFFICULTIES, type RaidDifficultyLevel } from './wow.js';

/** Cabeçalho que o addon emite. Versão diferente é recusada, não adivinhada. */
export const SESSION_PASTE_VERSION = 'TILC/1';

/**
 * O que o addon escreve quando não sabe o valor.
 *
 * Convenção dele, não nossa: `Campo()` no `Export.lua` troca `nil` por isto em
 * vez de derrubar a janela do jogo. Mesma marca do dump de journal.
 */
const DESCONHECIDO = '?';

/**
 * `difficultyID` do cliente → o vocabulário do site.
 *
 * **Terceira numeração de dificuldade do sistema.** O Warcraft Logs usa 3/4/5, o
 * cliente usa 14/15/16, e o site usa slug. Três inteiros para o mesmo conceito,
 * e trocar um pelo outro não gera erro nenhum — por isso a conversão é uma
 * tabela explícita, e não aritmética.
 *
 * Só as três de raid organizada. LFR e as numerações antigas de 10/25 ficam de
 * fora: sessão de loot council não acontece nelas, e mapear o que não se usa é
 * convidar erro.
 */
const DIFICULDADE_DO_CLIENTE: Readonly<Record<number, RaidDifficultyLevel>> = {
  14: RAID_DIFFICULTIES.NORMAL,
  15: RAID_DIFFICULTIES.HEROIC,
  16: RAID_DIFFICULTIES.MYTHIC,
};

/** Uma peça da colagem. */
export interface SessionPasteItem {
  /** Ordem na colagem. É o que distingue duas cópias do mesmo item. */
  position: number;

  itemId: number;

  /** O `itemString` inteiro e cru, com socket, terciário e upgrade. */
  itemString: string;

  /**
   * Quem lootou NO JOGO — entrada para a decisão, nunca o resultado dela.
   *
   * Nulo quando o addon não soube dizer. Ler isto como destinatário final
   * inverte o propósito da ferramenta.
   */
  looter: { name: string; realm: string } | null;

  /**
   * `auto` quando o addon capturou sozinho, `manual` quando o loot master
   * acrescentou à mão. Guardado cru: é informação sobre a confiança da linha, e
   * inventar um enum fechado recusaria uma origem nova do addon.
   */
  origem: string;
}

/** Uma colagem inteira: um boss e o que caiu nele. */
export interface SessionPaste {
  /** `dungeonEncounterID` do jogo — o mesmo espaço de id do catálogo e do WCL. */
  encounterId: number | null;

  /** LOCALIZADO. Só para leitura humana; a decisão é sempre pelo id. */
  encounterName: string;

  /** Já convertida. Nula quando o `difficultyID` não é de raid organizada. */
  difficulty: RaidDifficultyLevel | null;

  /** O número cru do cliente, para o caso de a conversão não ter dado. */
  rawDifficultyId: number | null;

  /** `instanceMapID` do cliente. NÃO é o id de zona do Warcraft Logs. */
  instanceId: number | null;
  instanceName: string;

  items: SessionPasteItem[];
}

function campo(partes: string[], nome: string): string | undefined {
  const achado = partes.find((p) => p.startsWith(`${nome}=`));
  return achado?.slice(nome.length + 1);
}

/** Texto do cabeçalho, com `?` e vazio virando nulo. */
function texto(partes: string[], nome: string): string {
  const bruto = campo(partes, nome);
  return bruto === undefined || bruto === DESCONHECIDO ? '' : bruto;
}

/** Inteiro do cabeçalho. `?` vira nulo em vez de estourar — é lacuna prevista. */
function inteiroOpcional(partes: string[], nome: string): number | null {
  const bruto = campo(partes, nome);
  if (bruto === undefined || bruto === DESCONHECIDO || bruto === '') return null;

  const valor = Number(bruto);
  return Number.isInteger(valor) && valor > 0 ? valor : null;
}

/**
 * O `itemID` do `itemString`.
 *
 * Posição 1, e não 0: a string começa com o literal `item`. Ler o 0 devolveria
 * `NaN` sempre — o mesmo erro de deslocamento que custou uma leitura inteira do
 * `itemContext` antes.
 */
function itemIdDoItemString(itemString: string, onde: string): number {
  const valor = Number(itemString.split(':')[1]);

  if (!Number.isInteger(valor) || valor <= 0) {
    throw new Error(`${onde}: não consegui ler o itemID de "${itemString}"`);
  }
  return valor;
}

/**
 * Lê a colagem que o loot master traz do addon.
 *
 * Falha com o número da linha, porque a entrada é texto colado à mão e o modo
 * normal de errar é colar pela metade. É por isso que o formato é orientado a
 * linha e não JSON: colagem truncada perde linhas de forma visível, em vez de
 * virar um erro de parse que não diz quanto se perdeu.
 */
export function parseSessionPaste(texto_: string): SessionPaste {
  // Editor no Windows grava UTF-8 com BOM sem avisar, e a caixa do jogo pode
  // trazer \r. Os dois quebrariam o casamento da primeira linha.
  const linhas = texto_.replace(/^﻿/, '').split(/\r?\n/);

  let colagem: SessionPaste | undefined;

  linhas.forEach((linhaBruta, indice) => {
    const linha = linhaBruta.trim();

    // `--` é como o próprio addon marca "nenhum item neste grupo".
    if (linha === '' || linha.startsWith('#') || linha.startsWith('--')) return;

    const onde = `linha ${indice + 1}`;
    const partes = linha.split('\t').map((p) => p.trim());

    if (colagem === undefined) {
      colagem = lerCabecalho(partes, onde);
      return;
    }

    colagem.items.push(lerItem(partes, colagem.items.length + 1, onde));
  });

  if (colagem === undefined) {
    throw new Error(`a colagem está vazia ou não começa com "${SESSION_PASTE_VERSION}"`);
  }
  if (colagem.items.length === 0) {
    throw new Error('a colagem não tem item nenhum — o grupo do addon estava vazio?');
  }

  return colagem;
}

function lerCabecalho(partes: string[], onde: string): SessionPaste {
  const [versao] = partes;

  if (versao !== SESSION_PASTE_VERSION) {
    throw new Error(
      `${onde}: esperava o cabeçalho "${SESSION_PASTE_VERSION}", veio "${versao ?? ''}". ` +
        'Versão diferente do addon precisa de parser próprio.',
    );
  }

  const rawDifficultyId = inteiroOpcional(partes, 'difficulty');

  return {
    encounterId: inteiroOpcional(partes, 'encounter'),
    encounterName: texto(partes, 'encounterName'),
    difficulty: rawDifficultyId === null ? null : (DIFICULDADE_DO_CLIENTE[rawDifficultyId] ?? null),
    rawDifficultyId,
    instanceId: inteiroOpcional(partes, 'instance'),
    instanceName: texto(partes, 'instanceName'),
    items: [],
  };
}

function lerItem(partes: string[], position: number, onde: string): SessionPasteItem {
  const [itemString, looterBruto, origem] = partes;

  if (!itemString || !itemString.startsWith('item:')) {
    throw new Error(
      `${onde}: esperava uma linha de item começando com "item:", veio "${itemString ?? ''}"`,
    );
  }

  return {
    position,
    itemId: itemIdDoItemString(itemString, onde),
    itemString,
    // O addon escreve `Nome-Realm`, à moda do cliente do jogo. Quem normaliza é
    // quem for gravar — Regra 6.
    looter:
      looterBruto === undefined || looterBruto === DESCONHECIDO
        ? null
        : splitNomeRealm(looterBruto),
    origem: origem === undefined || origem === DESCONHECIDO ? '' : origem,
  };
}
