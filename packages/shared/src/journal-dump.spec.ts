import { describe, expect, it } from 'vitest';
import { parseJournalDump } from './journal-dump.js';
import { SPECS } from './wow.js';

/** Monta o texto com tab de verdade, que é o separador do formato. */
const dump = (...linhas: string[]) => linhas.join('\n');

const CABECALHO = 'TILCJ/1\tinstance=1307\tmap=2912';

describe('parseJournalDump', () => {
  it('lê instância, mapa, bosses e itens de um dump real', () => {
    const resultado = parseJournalDump(
      dump(
        CABECALHO,
        'spec\t71\tWARRIOR\tArms',
        '# Imperator Averzian',
        'boss\t2733\t3176',
        'item\t249344\t13\t71,72,73',
        '# Vorasius',
        'boss\t2734\t3177',
        'item\t249353\t14\t253,254',
      ),
    );

    expect(resultado.journalInstanceId).toBe(1307);
    expect(resultado.instanceMapId).toBe(2912);
    expect(resultado.bosses).toHaveLength(2);
    expect(resultado.bosses[0]).toMatchObject({
      journalEncounterId: 2733,
      dungeonEncounterId: 3176,
    });
    expect(resultado.bosses[0]?.items[0]).toEqual({
      itemId: 249344,
      specs: [SPECS.WARRIOR_ARMS, SPECS.WARRIOR_FURY, SPECS.WARRIOR_PROTECTION],
    });
  });

  it('descarta o filterType, inclusive o `-1` que o addon emitia', () => {
    // O campo é inútil, enganoso e instável: o cliente só o devolve para item já
    // em cache, então num laço de 100 itens ele vem ausente na maioria. Ler e
    // descartar mantém válidos os dumps já colhidos.
    const resultado = parseJournalDump(
      dump(CABECALHO, 'boss\t2733\t3176', 'item\t264497\t-1\t71', 'item\t249350\t14\t72'),
    );

    expect(resultado.bosses[0]?.items).toEqual([
      { itemId: 264497, specs: [SPECS.WARRIOR_ARMS] },
      { itemId: 249350, specs: [SPECS.WARRIOR_FURY] },
    ]);
  });

  it('traduz o specID do jogo para o nosso slug', () => {
    // O cliente só entrega nome de spec localizado, então o número é a única
    // identidade que atravessa. 1480 é a Devourer, que nasceu nesta expansão.
    const resultado = parseJournalDump(
      dump(CABECALHO, 'boss\t2733\t3176', 'item\t249306\t0\t577,581,1480'),
    );

    expect(resultado.bosses[0]?.items[0]?.specs).toEqual([
      SPECS.DEMON_HUNTER_HAVOC,
      SPECS.DEMON_HUNTER_VENGEANCE,
      SPECS.DEMON_HUNTER_DEVOURER,
    ]);
  });

  it('recusa specID que o site não conhece, em vez de descartar', () => {
    // Descartar produziria item com uma spec a menos na lista de quem pode dar
    // need, sem erro nenhum. Foi o que quase aconteceu com a Devourer.
    expect(() =>
      parseJournalDump(dump(CABECALHO, 'boss\t2733\t3176', 'item\t249306\t0\t577,9999')),
    ).toThrow(/9999.*SPEC_BY_GAME_ID/s);
  });

  it('recusa specID desconhecido que apareça só na legenda', () => {
    expect(() =>
      parseJournalDump(dump(CABECALHO, 'spec\t9999\tNOVA\tSpec Nova', 'boss\t2733\t3176')),
    ).toThrow(/9999/);
  });

  it('junta todos os ids desconhecidos numa mensagem só', () => {
    // Uma expansão que acrescenta três specs não deve exigir três execuções
    // para descobrir as três.
    expect(() =>
      parseJournalDump(dump(CABECALHO, 'boss\t2733\t3176', 'item\t1\t0\t9999,8888')),
    ).toThrow(/8888, 9999/);
  });

  it('aceita `?` no dungeonEncounterId e no mapa', () => {
    const resultado = parseJournalDump(
      dump('TILCJ/1\tinstance=1307\tmap=?', 'boss\t2733\t?', 'item\t1\t0\t71'),
    );

    expect(resultado.instanceMapId).toBeUndefined();
    expect(resultado.bosses[0]?.dungeonEncounterId).toBeUndefined();
  });

  it('ignora comentário, linha vazia e \\r de colagem do jogo', () => {
    const resultado = parseJournalDump(
      ['# comentário', CABECALHO, '', 'boss\t2733\t3176', 'item\t1\t0\t71', ''].join('\r\n'),
    );

    expect(resultado.bosses[0]?.items).toHaveLength(1);
  });

  it('aceita item sem spec nenhuma', () => {
    const resultado = parseJournalDump(dump(CABECALHO, 'boss\t2733\t3176', 'item\t1\t0\t'));

    expect(resultado.bosses[0]?.items[0]?.specs).toEqual([]);
  });

  describe('colagem quebrada', () => {
    it('recusa dump que perdeu o cabeçalho, dizendo o que veio', () => {
      // O jeito normal de errar aqui é colar pela metade.
      expect(() => parseJournalDump(dump('boss\t2733\t3176'))).toThrow(/tem que começar/);
    });

    it('recusa item que aparece antes de qualquer boss', () => {
      expect(() => parseJournalDump(dump(CABECALHO, 'item\t1\t0\t71'))).toThrow(
        /linha 2.*antes de qualquer boss/s,
      );
    });

    it('recusa dump sem boss nenhum', () => {
      expect(() => parseJournalDump(CABECALHO)).toThrow(/boss nenhum/);
    });

    it('recusa linha de tipo desconhecido em vez de pular', () => {
      expect(() => parseJournalDump(dump(CABECALHO, 'lixo\t1\t2'))).toThrow(/desconhecido "lixo"/);
    });

    it('aponta a linha quando o número não é número', () => {
      expect(() => parseJournalDump(dump(CABECALHO, 'boss\tabc\t3176'))).toThrow(/linha 2/);
    });

    it('remove o BOM que editor do Windows grava sem avisar', () => {
      const resultado = parseJournalDump(
        `﻿${dump(CABECALHO, 'boss\t2733\t3176', 'item\t1\t0\t71')}`,
      );

      expect(resultado.journalInstanceId).toBe(1307);
    });
  });
});
