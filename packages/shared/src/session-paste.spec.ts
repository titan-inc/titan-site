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

  describe('cabeçalho errado LANÇA — sem ele não há sessão', () => {
    it('outra versão do formato', () => {
      // Versão diferente precisa de parser próprio. Tentar ler assim mesmo
      // gravaria dado errado sem ninguém notar.
      expect(() => parseSessionPaste('TILC/2\tencounter=1\n' + item(MITICO))).toThrow(/TILC\/1/);
    });

    it('texto que não é colagem nenhuma', () => {
      expect(() => parseSessionPaste('oi tudo bem')).toThrow(/TILC\/1/);
      expect(() => parseSessionPaste('')).toThrow(/vazia/);
    });
  });

  describe('linha torta NÃO derruba a colagem', () => {
    it('reporta a linha e mantém as boas', () => {
      // Colagem parcial acontece — o jogo corta, o Ctrl+C pega pela metade.
      // Perder cinco itens porque o sexto veio errado é pior que reportar o
      // sexto, e o loot master corrige à mão o que faltou.
      const lido = parseSessionPaste(
        colagem(item(MITICO), 'lixo\tFulano-Azralon\tauto', item(HEROICO)),
      );

      expect(lido.items).toHaveLength(2);
      expect(lido.problemas).toEqual([
        { linha: 3, motivo: expect.stringContaining('item:') as unknown as string },
      ]);
    });

    it('a numeração das posições ignora as linhas ruins', () => {
      // Position é a identidade do drop dentro da sessão. Se a linha ruim
      // consumisse um número, haveria buraco e a segunda cópia de um item
      // pareceria ser a terceira.
      const lido = parseSessionPaste(colagem('lixo', item(MITICO), item(HEROICO)));

      expect(lido.items.map((i) => i.position)).toEqual([1, 2]);
    });

    it('itemString sem itemID legível também é problema, não exceção', () => {
      const lido = parseSessionPaste(colagem(item('item:abc::::::::80:0::6:0')));

      expect(lido.items).toHaveLength(0);
      expect(lido.problemas[0]?.motivo).toMatch(/itemID/);
    });
  });

  it('colagem só com o cabeçalho devolve zero itens, sem estourar', () => {
    // O addon emite "-- nenhum item neste grupo --", e a linha de comentário é
    // ignorada. Quem decide o que fazer com sessão vazia é o construtor, que tem
    // como avisar o loot master — melhor que uma exceção sem contexto.
    const lido = parseSessionPaste(`${cabecalho}\n-- nenhum item neste grupo --`);

    expect(lido.items).toEqual([]);
    expect(lido.problemas).toEqual([]);
    expect(lido.encounterId).toBe(3176);
  });

  describe('a colagem REAL de raid, da TIT-79', () => {
    /*
      Capturada em Tomb of Sargeras, dois bosses seguidos, com `/tilc debug`.
      É a única colagem de verdade que existe, e é o que valida o cabeçalho.

      O nome do jogador foi trocado por um fictício: o repo é público e o
      CLAUDE.md proíbe versionar nome real de membro. Todo o resto é literal.
    */
    const REAL = [
      'TILC/1\tencounter=2036\tencounterName=Harjatan\tdifficulty=14\tinstance=1676\tinstanceName=Tomb of Sargeras',
      'item:147146::::::::90:252::3:1:9091:1:28:498:::::\tFulano-Azralon\tauto',
      'item:147129::::::::90:252::3:1:9091:1:28:498:::::\tFulano-Azralon\tauto',
    ].join('\n');

    it('lê o cabeçalho inteiro', () => {
      const lido = parseSessionPaste(REAL);

      expect(lido).toMatchObject({
        encounterId: 2036,
        encounterName: 'Harjatan',
        difficulty: 'normal',
        rawDifficultyId: 14,
        instanceId: 1676,
        instanceName: 'Tomb of Sargeras',
      });
      expect(lido.problemas).toEqual([]);
    });

    it('o itemContext concorda com a dificuldade do cabeçalho', () => {
      // `itemContext=3` é RaidNormal e `difficulty=14` é Normal — os dois
      // dizendo a mesma coisa por caminhos independentes. É a conferência que a
      // TIT-79 registrou ao validar o addon em raid.
      const lido = parseSessionPaste(REAL);

      expect(lido.items[0]?.itemContext).toBe(3);
      expect(lido.difficulty).toBe('normal');
    });

    it('lê os bônus pelo contador, sem levar os modifiers junto', () => {
      // A cauda real é `:1:9091:1:28:498:::::` — um bônus (9091), depois um
      // modifier (28, 498) e colons vazios. Fatiar até o fim traria tudo.
      const lido = parseSessionPaste(REAL);

      expect(lido.items[0]?.bonusIds).toEqual([9091]);
    });

    it('as duas cópias entram como drops separados', () => {
      const lido = parseSessionPaste(REAL);

      expect(lido.items.map((i) => i.itemId)).toEqual([147146, 147129]);
      expect(lido.items.map((i) => i.position)).toEqual([1, 2]);
    });
  });

  describe('a sexta armadilha: campo vazio quer dizer coisas diferentes', () => {
    // Os dois casos vieram de loot de boss real: um reagente épico e uma
    // receita. Nenhum item "normal" de raid expõe isso, que é justamente por que
    // ninguém pensa em usá-los como fixture.

    it('numBonusIDs vazio é ZERO bônus', () => {
      const lido = parseSessionPaste(colagem(item('item:193873::::::::90:252::5::1:28:2646:::::')));

      expect(lido.items[0]?.bonusIds).toEqual([]);
      expect(lido.items[0]?.itemContext).toBe(5);
    });

    it('itemContext vazio é DESCONHECIDO, não zero', () => {
      // Colapsar em 0 afirmaria "contexto 0", que é valor válido de outra coisa.
      const lido = parseSessionPaste(colagem(item('item:204717::::::::90:252:::::::::')));

      expect(lido.items[0]?.itemContext).toBeNull();
      expect(lido.items[0]?.bonusIds).toEqual([]);
      expect(lido.items[0]?.itemId).toBe(204717);
    });
  });

  it('tolera BOM e CRLF', () => {
    // Editor no Windows grava UTF-8 com BOM sem avisar, e a caixa do jogo traz
    // \r. Os dois quebrariam o casamento da primeira linha.
    const lido = parseSessionPaste(`﻿${cabecalho}\r\n${item(MITICO)}\r\n`);

    expect(lido.items).toHaveLength(1);
  });
});
