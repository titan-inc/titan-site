import { parseItemString } from './item-string.js';
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
   * De onde a peça veio, do próprio `itemString`. Nulo é "não sei", nunca zero.
   *
   * Vale mais que o `difficulty` do cabeçalho para dizer a origem da peça: o
   * cabeçalho diz em que sala o grupo estava, o contexto diz de onde o item
   * caiu. Ver TIT-76.
   */
  itemContext: number | null;

  /** Os bônus, delimitados pelo contador. Vazio é zero bônus, não erro. */
  bonusIds: number[];

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

  /**
   * Linhas que não deu para ler, com o número da linha e o motivo.
   *
   * **Linha torta não derruba a colagem.** Colagem parcial acontece — o jogo
   * corta, o Ctrl+C pega pela metade — e perder cinco itens porque o sexto veio
   * errado é pior que reportar o sexto. Quem chama mostra a lista ao loot
   * master, que corrige à mão o que faltou.
   *
   * O cabeçalho é o oposto: cabeçalho errado lança, porque sem ele não há
   * sessão a montar.
   */
  problemas: Array<{ linha: number; motivo: string }>;
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

    const item = lerItem(partes, colagem.items.length + 1);

    if (typeof item === 'string') {
      colagem.problemas.push({ linha: indice + 1, motivo: item });
      return;
    }

    colagem.items.push(item);
  });

  if (colagem === undefined) {
    throw new Error(`a colagem está vazia ou não começa com "${SESSION_PASTE_VERSION}"`);
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
    problemas: [],
  };
}

/** O item lido, ou o motivo de não ter dado — string é a falha. */
function lerItem(partes: string[], position: number): SessionPasteItem | string {
  const [itemString, looterBruto, origem] = partes;

  if (!itemString || !itemString.startsWith('item:')) {
    return `esperava uma linha de item começando com "item:", veio "${itemString ?? ''}"`;
  }

  const lido = parseItemString(itemString);
  if (lido === null) return `não consegui ler o itemID de "${itemString}"`;

  return {
    position,
    itemId: lido.itemId,
    itemString,
    itemContext: lido.itemContext,
    bonusIds: lido.bonusIds,
    // O addon escreve `Nome-Realm`, à moda do cliente do jogo. Quem normaliza é
    // quem for gravar — Regra 6.
    looter:
      looterBruto === undefined || looterBruto === DESCONHECIDO
        ? null
        : splitNomeRealm(looterBruto),
    origem: origem === undefined || origem === DESCONHECIDO ? '' : origem,
  };
}
