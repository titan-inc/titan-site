import { BONUS_KINDS, type BonusDictionaryEntry } from '@titan/shared';
import { decodeBonuses } from './wow-bonus-decoder';

/**
 * Dicionário de teste. Os nomes e ids aqui são PLAUSÍVEIS, não a curadoria
 * real do jogo — mesmo espírito do `item-string.spec.ts`: o formato é real, o
 * conteúdo é inventado só para o teste ter algo a decodificar.
 */
function dicionario(...entradas: BonusDictionaryEntry[]): Map<number, BonusDictionaryEntry> {
  return new Map(entradas.map((e) => [e.bonusId, e]));
}

const MYTH_RANK_4: BonusDictionaryEntry = {
  bonusId: 12806,
  kind: BONUS_KINDS.TRACK,
  trackName: 'Myth',
  trackRank: 4,
  trackMaxRank: 6,
};
const MYTH_RANK_4_COM_ILVL: BonusDictionaryEntry = { ...MYTH_RANK_4, itemLevel: 681 };
const MYTH_RANK_6: BonusDictionaryEntry = {
  bonusId: 12808,
  kind: BONUS_KINDS.TRACK,
  trackName: 'Myth',
  trackRank: 6,
  trackMaxRank: 6,
};
const HERO_RANK_2: BonusDictionaryEntry = {
  bonusId: 12794,
  kind: BONUS_KINDS.TRACK,
  trackName: 'Hero',
  trackRank: 2,
  trackMaxRank: 6,
};
const AVOIDANCE: BonusDictionaryEntry = {
  bonusId: 40,
  kind: BONUS_KINDS.TERTIARY,
  tertiary: 'avoidance',
};
const LEECH: BonusDictionaryEntry = { bonusId: 41, kind: BONUS_KINDS.TERTIARY, tertiary: 'leech' };
const SOCKET: BonusDictionaryEntry = { bonusId: 13534, kind: BONUS_KINDS.SOCKET };
const SOCKET_2: BonusDictionaryEntry = { bonusId: 13668, kind: BONUS_KINDS.SOCKET };

describe('decodeBonuses', () => {
  it('decodifica track, terciário e socket juntos', () => {
    const resultado = decodeBonuses(
      [MYTH_RANK_4.bonusId, AVOIDANCE.bonusId, SOCKET.bonusId],
      dicionario(MYTH_RANK_4, AVOIDANCE, SOCKET),
    );

    expect(resultado).toEqual({
      itemLevel: null,
      track: { nome: 'Myth', rank: 4, de: 6 },
      sockets: 1,
      terciarios: ['avoidance'],
      desconhecidos: [],
    });
  });

  it('bonus fora do dicionário vira desconhecido, e não trava o resto', () => {
    const resultado = decodeBonuses(
      [MYTH_RANK_4.bonusId, 9999, AVOIDANCE.bonusId],
      dicionario(MYTH_RANK_4, AVOIDANCE),
    );

    expect(resultado.desconhecidos).toEqual([9999]);
    expect(resultado.track).toEqual({ nome: 'Myth', rank: 4, de: 6 });
    expect(resultado.terciarios).toEqual(['avoidance']);
  });

  it('bonusIds vazio devolve a estrutura zerada, sem estourar', () => {
    expect(decodeBonuses([], dicionario())).toEqual({
      itemLevel: null,
      track: null,
      sockets: 0,
      terciarios: [],
      desconhecidos: [],
    });
  });

  it('itemLevel curado no bonus de track passa para a saída', () => {
    const resultado = decodeBonuses(
      [MYTH_RANK_4_COM_ILVL.bonusId],
      dicionario(MYTH_RANK_4_COM_ILVL),
    );

    expect(resultado.itemLevel).toBe(681);
  });

  it('bonus de track SEM itemLevel curado deixa a saída em null — nunca aproxima', () => {
    const resultado = decodeBonuses([MYTH_RANK_4.bonusId], dicionario(MYTH_RANK_4));

    expect(resultado.itemLevel).toBeNull();
  });

  it('soma mais de um socket', () => {
    const resultado = decodeBonuses(
      [SOCKET.bonusId, SOCKET_2.bonusId],
      dicionario(SOCKET, SOCKET_2),
    );

    expect(resultado.sockets).toBe(2);
  });

  it('mais de um terciário vira lista, na ordem em que apareceram', () => {
    const resultado = decodeBonuses(
      [LEECH.bonusId, AVOIDANCE.bonusId],
      dicionario(LEECH, AVOIDANCE),
    );

    expect(resultado.terciarios).toEqual(['leech', 'avoidance']);
  });

  it('dois bonus de track no mesmo itemString: o último vence, sem estourar', () => {
    // Não deveria acontecer num item real, mas é dado que o servidor manda —
    // degradar é melhor que a sessão quebrar no meio de uma raid.
    const resultado = decodeBonuses(
      [HERO_RANK_2.bonusId, MYTH_RANK_6.bonusId],
      dicionario(HERO_RANK_2, MYTH_RANK_6),
    );

    expect(resultado.track).toEqual({ nome: 'Myth', rank: 6, de: 6 });
  });

  it('itemLevel anda junto do track: o último bonus decide os dois juntos', () => {
    // MYTH_RANK_4_COM_ILVL vem primeiro e tem itemLevel; MYTH_RANK_6 vem
    // depois e não tem — o último vence nos dois campos, não só no track.
    const resultado = decodeBonuses(
      [MYTH_RANK_4_COM_ILVL.bonusId, MYTH_RANK_6.bonusId],
      dicionario(MYTH_RANK_4_COM_ILVL, MYTH_RANK_6),
    );

    expect(resultado.track).toEqual({ nome: 'Myth', rank: 6, de: 6 });
    expect(resultado.itemLevel).toBeNull();
  });

  it('bonus repetido na lista conta socket duas vezes e terciário duas vezes', () => {
    // O itemString pode repetir um id — o decodificador não deduplica, porque
    // não sabe se é repetição legítima do jogo ou não. Reflete o que chegou.
    const resultado = decodeBonuses(
      [SOCKET.bonusId, SOCKET.bonusId, AVOIDANCE.bonusId, AVOIDANCE.bonusId],
      dicionario(SOCKET, AVOIDANCE),
    );

    expect(resultado.sockets).toBe(2);
    expect(resultado.terciarios).toEqual(['avoidance', 'avoidance']);
  });
});
