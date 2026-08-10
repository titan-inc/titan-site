import { SPEC_BY_GAME_ID, type WowSpec } from './wow.js';

/**
 * O dump do Encounter Journal, colado do addon.
 *
 * Existe porque a ponte entre o `journalEncounterID` (que a API REST da Blizzard
 * usa) e o `dungeonEncounterID` (que o jogo e o Warcraft Logs usam) **só existe
 * dentro do cliente do WoW**. Medido em 09/08/2026: a REST do journal não
 * publica o id do jogo em nenhum dos oito endpoints, e o `Encounter.journalID`
 * do Warcraft Logs vem zerado em 464 dos 466 encounters.
 *
 * E o cliente sabe no dia do patch, porque o journal vem dentro dele — enquanto
 * o Warcraft Logs só conhece uma raid depois que alguém sobe log dela.
 *
 * Formato, orientado a linha e separado por tab:
 *
 * ```
 * TILCJ/1        instance=1307   map=2912
 * spec   71      WARRIOR         Arms
 * # Imperator Averzian
 * boss   2733    3176
 * item   264497  14              71,72,73,65,...
 * ```
 *
 * Linha e tab, e não JSON, pelo mesmo motivo da colagem de loot: colagem
 * truncada falha de forma **visível**, faltando linha, e cada linha é
 * independente. JSON cortado no meio vira erro de parse sem dizer quanto se
 * perdeu.
 *
 * Só entram números. O cliente devolve nome de item, de slot e de tipo de
 * armadura **traduzidos**, e ícone como fileID em vez do slug — tudo isso o site
 * resolve pela REST, a partir do `itemId`. O que é localizado vem em linha `#`,
 * que é comentário.
 */

/** Cabeçalho aceito. Subir a versão é como o addon muda o formato sem quebrar. */
export const JOURNAL_DUMP_VERSION = 'TILCJ/1';

export interface JournalDumpItem {
  itemId: number;

  /**
   * Enum de slot do cliente.
   *
   * **Não serve de filtro de lixo.** O balde 14 ("outros") junta Decor, reagente,
   * receita **e token de tier** — e token de tier é o loot mais disputado da
   * raid. O que separa um do outro é a lista de specs: token de placas sai com
   * Warrior, Paladin e DK; Decor sai com as 40.
   */
  filterType: number;

  /** Specs que o journal mostra para esta peça. Proposta, nunca decisão. */
  specs: WowSpec[];
}

export interface JournalDumpBoss {
  journalEncounterId: number;
  /** Ausente quando o cliente não devolveu o id. Não deveria acontecer. */
  dungeonEncounterId?: number;
  items: JournalDumpItem[];
}

export interface JournalDump {
  journalInstanceId: number;
  instanceMapId?: number;
  bosses: JournalDumpBoss[];
}

/** `?` é como o addon escreve "não sei", para nunca inventar zero. */
const DESCONHECIDO = '?';

function inteiro(bruto: string | undefined, onde: string): number {
  const valor = Number(bruto);
  if (!bruto || !Number.isInteger(valor) || valor <= 0) {
    throw new Error(`${onde}: esperava um inteiro positivo, veio "${bruto ?? ''}"`);
  }
  return valor;
}

/**
 * Separado do positivo porque `filterType` **começa em zero** — 0 é Head.
 *
 * A primeira versão usava o validador positivo aqui, e recusava o dump real no
 * primeiro item de capacete.
 */
function inteiroNaoNegativo(bruto: string | undefined, onde: string): number {
  const valor = Number(bruto);
  if (bruto === undefined || bruto === '' || !Number.isInteger(valor) || valor < 0) {
    throw new Error(`${onde}: esperava um inteiro não negativo, veio "${bruto ?? ''}"`);
  }
  return valor;
}

function inteiroOpcional(bruto: string | undefined, onde: string): number | undefined {
  if (!bruto || bruto === DESCONHECIDO) return undefined;
  return inteiro(bruto, onde);
}

/** `instance=1307` → 1307. */
function campo(partes: string[], nome: string): string | undefined {
  const achado = partes.find((p) => p.startsWith(`${nome}=`));
  return achado?.slice(nome.length + 1);
}

/**
 * Lê o dump colado do addon.
 *
 * Falha com o número da linha, porque a entrada é texto colado à mão e o modo
 * normal de errar é colar pela metade.
 */
export function parseJournalDump(texto: string): JournalDump {
  // Editor no Windows grava UTF-8 com BOM sem avisar, e a caixa do jogo pode
  // trazer \r. Os dois quebrariam o casamento da primeira linha.
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/);

  let dump: JournalDump | undefined;
  let bossCorrente: JournalDumpBoss | undefined;
  const specsDesconhecidas = new Set<number>();

  linhas.forEach((linhaBruta, indice) => {
    const linha = linhaBruta.trim();
    if (linha === '' || linha.startsWith('#')) return;

    const partes = linha.split('\t').map((p) => p.trim());
    const [tipo] = partes;
    const onde = `linha ${indice + 1}`;

    if (tipo === JOURNAL_DUMP_VERSION) {
      dump = {
        journalInstanceId: inteiro(campo(partes, 'instance'), `${onde} (instance)`),
        instanceMapId: inteiroOpcional(campo(partes, 'map'), `${onde} (map)`),
        bosses: [],
      };
      return;
    }

    if (!dump) {
      throw new Error(
        `${onde}: o dump tem que começar com "${JOURNAL_DUMP_VERSION}". ` +
          `Veio "${linha.slice(0, 40)}" — provavelmente a colagem perdeu o começo.`,
      );
    }

    if (tipo === 'spec') {
      const id = inteiro(partes[1], `${onde} (specID)`);
      if (!SPEC_BY_GAME_ID[id]) specsDesconhecidas.add(id);
      return;
    }

    if (tipo === 'boss') {
      bossCorrente = {
        journalEncounterId: inteiro(partes[1], `${onde} (journalEncounterId)`),
        dungeonEncounterId: inteiroOpcional(partes[2], `${onde} (dungeonEncounterId)`),
        items: [],
      };
      dump.bosses.push(bossCorrente);
      return;
    }

    if (tipo === 'item') {
      if (!bossCorrente) {
        throw new Error(`${onde}: item antes de qualquer boss`);
      }

      const specs: WowSpec[] = [];
      for (const bruto of (partes[3] ?? '').split(',')) {
        if (bruto === '') continue;
        const id = inteiro(bruto, `${onde} (specID)`);
        const spec = SPEC_BY_GAME_ID[id];
        if (spec) specs.push(spec);
        else specsDesconhecidas.add(id);
      }

      bossCorrente.items.push({
        itemId: inteiro(partes[1], `${onde} (itemId)`),
        filterType: inteiroNaoNegativo(partes[2], `${onde} (filterType)`),
        specs,
      });
      return;
    }

    throw new Error(`${onde}: tipo de linha desconhecido "${tipo ?? ''}"`);
  });

  if (!dump) {
    throw new Error(`o dump está vazio ou não tem o cabeçalho "${JOURNAL_DUMP_VERSION}"`);
  }

  /*
   * Spec que o cliente conhece e o site não é ERRO, nunca descarte.
   *
   * Ignorar produziria itens com uma spec a menos na lista de quem pode dar
   * need, sem erro nenhum — e ninguém relacionaria as duas coisas. Já aconteceu
   * na prática: o cliente reporta 40 specs e o enum tinha 39, porque a
   * `demon-hunter-devourer` nasceu nesta expansão.
   */
  if (specsDesconhecidas.size > 0) {
    throw new Error(
      `specID que o site não conhece: ${[...specsDesconhecidas].sort((a, b) => a - b).join(', ')}. ` +
        'Spec nova no jogo — acrescente em SPEC_BY_GAME_ID e no enum WowSpec antes de carregar.',
    );
  }

  if (dump.bosses.length === 0) {
    throw new Error('o dump não tem boss nenhum');
  }

  return dump;
}
