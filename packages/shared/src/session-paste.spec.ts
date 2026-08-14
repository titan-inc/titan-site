import { describe, expect, it } from 'vitest';
import { parseSessionPaste, SESSION_PASTE_VERSION } from './session-paste.js';

/**
 * Uma colagem no formato real.
 *
 * Os `itemString` seguem o layout que o jogo emite — o mesmo do campo
 * `itemString` do export do RCLootCouncil, porque o addon extrai o link cru com
 * `link:match('|H(item[^|]+)|h')` e não monta nada.
 *
 * ATENÇÃO: o exemplo do README do addon **não** serve de fixture. Ele tem um
 * campo a menos, e montar teste em cima dele faria o parser nascer errado.
 *
 * Nomes fictícios: o repo é público.
 */
const cabecalho = [
  SESSION_PASTE_VERSION,
  'encounter=3176',
  'encounterName=Chimaerus, the Undreamt God',
  'difficulty=16',
  'instance=2912',
  'instanceName=The Voidspire',
].join('\t');

const item = (itemString: string, looter = 'Fulano-Azralon', origem = 'auto') =>
  [itemString, looter, origem].join('\t');

const MITICO = 'item:249344::::::::80:0::6:2:13335:12801';
const HEROICO = 'item:268229::::::::80:0::5:1:13334';

const colagem = (...linhas: string[]) => [cabecalho, ...linhas].join('\n');

describe('parseSessionPaste', () => {
  it('lê o cabeçalho e os itens', () => {
    const lido = parseSessionPaste(colagem(item(MITICO), item(HEROICO, 'Ciclano-Area52')));

    expect(lido).toMatchObject({
      encounterId: 3176,
      encounterName: 'Chimaerus, the Undreamt God',
      difficulty: 'mythic',
      rawDifficultyId: 16,
      instanceId: 2912,
      instanceName: 'The Voidspire',
    });
    expect(lido.items).toHaveLength(2);
  });

  describe('a dificuldade do cliente é a TERCEIRA numeração do sistema', () => {
    it('14/15/16 viram o vocabulário do site', () => {
      const de = (id: number) =>
        parseSessionPaste(colagem(item(MITICO)).replace('difficulty=16', `difficulty=${id}`))
          .difficulty;

      expect(de(14)).toBe('normal');
      expect(de(15)).toBe('heroic');
      expect(de(16)).toBe('mythic');
    });

    it('não confunde com a numeração do Warcraft Logs', () => {
      // O WCL usa 3/4/5 para as mesmas três dificuldades. Se alguém trocar as
      // tabelas, 5 viraria "mítico" em vez de nulo — e ninguém receberia erro.
      const de = (id: number) =>
        parseSessionPaste(colagem(item(MITICO)).replace('difficulty=16', `difficulty=${id}`));

      expect(de(5).difficulty).toBeNull();
      expect(de(5).rawDifficultyId).toBe(5);
    });

    it('dificuldade fora de raid organizada vira nula, e o número cru fica', () => {
      // LFR e as numerações antigas de 10/25. Sessão de conselho não acontece
      // nelas; guardar o cru deixa investigar se aparecer.
      const lido = parseSessionPaste(
        colagem(item(MITICO)).replace('difficulty=16', 'difficulty=17'),
      );

      expect(lido.difficulty).toBeNull();
      expect(lido.rawDifficultyId).toBe(17);
    });
  });

  describe('o `?` do addon', () => {
    it('campo desconhecido no cabeçalho vira nulo, não a string "?"', () => {
      // `Campo()` no Export.lua troca nil por `?` em vez de derrubar a janela do
      // jogo. Gravar "?" como nome de boss seria propagar o buraco.
      const lido = parseSessionPaste(
        colagem(item(MITICO)).replace('encounter=3176', 'encounter=?'),
      );

      expect(lido.encounterId).toBeNull();
    });

    it('looter desconhecido vira nulo', () => {
      const lido = parseSessionPaste(colagem(item(MITICO, '?')));

      expect(lido.items[0]?.looter).toBeNull();
    });
  });

  describe('looter', () => {
    it('separa nome e realm à moda do cliente do jogo', () => {
      const lido = parseSessionPaste(colagem(item(MITICO, 'Shrëwd-Area52')));

      // Sem normalizar: quem grava é que aplica toCharacterKey/toRealmMatchKey.
      expect(lido.items[0]?.looter).toEqual({ name: 'Shrëwd', realm: 'Area52' });
    });

    it('looter sem realm vira nulo em vez de meia identidade', () => {
      expect(parseSessionPaste(colagem(item(MITICO, 'Fulano'))).items[0]?.looter).toBeNull();
    });
  });

  it('duas cópias do mesmo item são duas linhas, distinguidas pela posição', () => {
    // Duas cópias caem no mesmo boss e são duas decisões separadas.
    const lido = parseSessionPaste(colagem(item(MITICO), item(MITICO)));

    expect(lido.items.map((i) => i.position)).toEqual([1, 2]);
    expect(lido.items[0]?.itemId).toBe(lido.items[1]?.itemId);
  });

  it('guarda o itemString inteiro, sem interpretar', () => {
    // É o que o conselho precisa ver para votar sabendo o que está em jogo.
    const lido = parseSessionPaste(colagem(item(MITICO)));

    expect(lido.items[0]?.itemString).toBe(MITICO);
    expect(lido.items[0]?.itemId).toBe(249344);
  });

  it('guarda a origem crua', () => {
    expect(
      parseSessionPaste(colagem(item(MITICO, 'Fulano-Azralon', 'manual'))).items[0]?.origem,
    ).toBe('manual');
  });

  describe('o que faz a colagem ser recusada', () => {
    it('cabeçalho de outra versão', () => {
      // Versão diferente precisa de parser próprio. Tentar ler assim mesmo
      // gravaria dado errado sem ninguém notar.
      expect(() => parseSessionPaste('TILC/2\tencounter=1\n' + item(MITICO))).toThrow(/TILC\/1/);
    });

    it('texto que não é colagem nenhuma', () => {
      expect(() => parseSessionPaste('oi tudo bem')).toThrow(/TILC\/1/);
      expect(() => parseSessionPaste('')).toThrow(/vazia/);
    });

    it('colagem só com o cabeçalho', () => {
      // O addon emite "-- nenhum item neste grupo --" nesse caso, e a linha de
      // comentário é ignorada. Sobra uma sessão sem item, que não serve.
      expect(() => parseSessionPaste(cabecalho)).toThrow(/item nenhum/);
      expect(() => parseSessionPaste(`${cabecalho}\n-- nenhum item neste grupo --`)).toThrow(
        /item nenhum/,
      );
    });

    it('linha de item que não começa com `item:`, com o número da linha', () => {
      // Colar pela metade é o modo normal de errar, e o número da linha é o que
      // diz onde parou.
      expect(() => parseSessionPaste(colagem(item(MITICO), 'lixo\tFulano-Azralon\tauto'))).toThrow(
        /linha 3/,
      );
    });
  });

  it('tolera BOM e CRLF', () => {
    // Editor no Windows grava UTF-8 com BOM sem avisar, e a caixa do jogo traz
    // \r. Os dois quebrariam o casamento da primeira linha.
    const lido = parseSessionPaste(`﻿${cabecalho}\r\n${item(MITICO)}\r\n`);

    expect(lido.items).toHaveLength(1);
  });
});
