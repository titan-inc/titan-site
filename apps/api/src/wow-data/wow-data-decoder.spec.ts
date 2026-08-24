import type { BonusFacets } from '@titan/shared';
import { decodeBonuses } from './wow-data-decoder';

/**
 * Dicionário de teste. Os nomes e ids aqui são PLAUSÍVEIS, não a curadoria real
 * do jogo — mesmo espírito do `item-string.spec.ts`: o formato é real, o
 * conteúdo é inventado só para o teste ter algo a decodificar.
 */
function facetas(over: Partial<BonusFacets> & { bonusId: number }): BonusFacets {
  return {
    trackName: null,
    trackRank: null,
    trackMaxRank: null,
    trackScalingId: null,
    itemLevel: null,
    itemLevelMarcador: null,
    statIds: [],
    statAllocs: [],
    hasSocket: false,
    binding: null,
    difficulty: null,
    difficultyColor: null,
    quality: null,
    ...over,
  };
}

function dicionario(...entradas: BonusFacets[]): Map<number, BonusFacets> {
  return new Map(entradas.map((e) => [e.bonusId, e]));
}

const MYTH_4 = facetas({
  bonusId: 12806,
  trackName: 'Myth',
  trackRank: 4,
  trackMaxRank: 6,
  trackScalingId: 12,
});
const HERO_2 = facetas({
  bonusId: 12794,
  trackName: 'Hero',
  trackRank: 2,
  trackMaxRank: 6,
  trackScalingId: 12,
});
const AVOIDANCE = facetas({ bonusId: 40, statIds: [63], statAllocs: [3000] });
const LEECH = facetas({ bonusId: 41, statIds: [62], statAllocs: [3000] });
const SOCKET = facetas({ bonusId: 13534, hasSocket: true });
const SOCKET_2 = facetas({ bonusId: 13668, hasSocket: true });

describe('decodeBonuses', () => {
  it('decodifica track, terciário e socket juntos', () => {
    const resultado = decodeBonuses(
      [MYTH_4.bonusId, AVOIDANCE.bonusId, SOCKET.bonusId],
      dicionario(MYTH_4, AVOIDANCE, SOCKET),
    );

    expect(resultado).toEqual({
      itemLevel: null,
      track: { nome: 'Myth', rank: 4, de: 6, scalingId: 12 },
      sockets: 1,
      terciarios: [{ tipo: 'avoidance', alocacao: 3000 }],
      statsAdicionados: [{ statId: 63, alocacao: 3000 }],
      binding: null,
      dificuldade: null,
      qualidade: null,
      desconhecidos: [],
    });
  });

  /**
   * O caso que derrubou o `kind`: medido no build 12.1.0, 19% dos bonus ids
   * carregam mais de um significado, e o `12825` é track E qualidade E scale
   * config ao mesmo tempo. Um `switch` por kind perderia dois dos três.
   */
  it('UM bonus com várias facetas aciona todas', () => {
    const tudoDeUmaVez = facetas({
      bonusId: 12825,
      trackName: 'Veteran',
      trackRank: 1,
      trackMaxRank: 6,
      trackScalingId: 11,
      itemLevel: 279,
      quality: 4,
      difficulty: 'Raid Finder',
      difficultyColor: -16711936,
    });

    const resultado = decodeBonuses([12825], dicionario(tudoDeUmaVez));

    expect(resultado.track).toEqual({ nome: 'Veteran', rank: 1, de: 6, scalingId: 11 });
    expect(resultado.itemLevel).toBe(279);
    expect(resultado.dificuldade).toBe('Raid Finder');
  });

  /**
   * A versão anterior amarrava o ilvl à entrada de track. A árvore do escudo
   * devolve um bonus que só traz `Type 49` — sem track nenhum.
   */
  it('itemLevel é independente do track', () => {
    const soIlvl = facetas({ bonusId: 13702, itemLevel: 295 });

    const resultado = decodeBonuses([13702], dicionario(soIlvl));

    expect(resultado.itemLevel).toBe(295);
    expect(resultado.track).toBeNull();
  });

  it('vínculo imposto por bônus aparece na saída — é como cai o bonus loot', () => {
    const warbound = facetas({ bonusId: 11215, binding: 'warbound_until_equipped' });

    const resultado = decodeBonuses([11215], dicionario(warbound));

    expect(resultado.binding).toBe('warbound_until_equipped');
  });

  it('bonus fora do dicionário vira desconhecido, e não trava o resto', () => {
    const resultado = decodeBonuses(
      [MYTH_4.bonusId, 999999, AVOIDANCE.bonusId],
      dicionario(MYTH_4, AVOIDANCE),
    );

    expect(resultado.desconhecidos).toEqual([999999]);
    expect(resultado.track).toEqual({ nome: 'Myth', rank: 4, de: 6, scalingId: 12 });
    expect(resultado.terciarios).toEqual([{ tipo: 'avoidance', alocacao: 3000 }]);
  });

  it('bonusIds vazio devolve a estrutura zerada, sem estourar', () => {
    expect(decodeBonuses([], dicionario())).toEqual({
      itemLevel: null,
      track: null,
      sockets: 0,
      terciarios: [],
      statsAdicionados: [],
      binding: null,
      dificuldade: null,
      qualidade: null,
      desconhecidos: [],
    });
  });

  it('track sem itemLevel deixa a saída em null — nunca aproxima', () => {
    expect(decodeBonuses([MYTH_4.bonusId], dicionario(MYTH_4)).itemLevel).toBeNull();
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
      dicionario(AVOIDANCE, LEECH),
    );

    expect(resultado.terciarios).toEqual([
      { tipo: 'leech', alocacao: 3000 },
      { tipo: 'avoidance', alocacao: 3000 },
    ]);
  });

  it('dois bonus de track no mesmo itemString: o último vence, sem estourar', () => {
    const resultado = decodeBonuses([MYTH_4.bonusId, HERO_2.bonusId], dicionario(MYTH_4, HERO_2));

    expect(resultado.track).toEqual({ nome: 'Hero', rank: 2, de: 6, scalingId: 12 });
  });

  it('bonus repetido na lista conta socket duas vezes e terciário duas vezes', () => {
    const resultado = decodeBonuses(
      [SOCKET.bonusId, SOCKET.bonusId, LEECH.bonusId, LEECH.bonusId],
      dicionario(SOCKET, LEECH),
    );

    expect(resultado.sockets).toBe(2);
    expect(resultado.terciarios).toEqual([
      { tipo: 'leech', alocacao: 3000 },
      { tipo: 'leech', alocacao: 3000 },
    ]);
  });

  /**
   * O `scalingId` sai CRU de propósito. Quem decide se a contagem `4/6`
   * aparece é o renderizador, comparando com a season corrente — peça de
   * season passada mostra só `Myth`. Congelar a decisão aqui acertaria hoje e
   * erraria a partir da virada, sem nada disparar.
   */
  it('o scalingId do track chega intacto, sem virar decisão', () => {
    const seasonPassada = facetas({
      bonusId: 12833,
      trackName: 'Champion',
      trackRank: 1,
      trackMaxRank: 6,
      trackScalingId: 11,
    });

    expect(decodeBonuses([12833], dicionario(seasonPassada)).track?.scalingId).toBe(11);
  });

  /**
   * `qualidade` segue regra OPOSTA às outras facetas escalares: PRIMEIRO
   * vence, não último. Mesma regra que `resolverQualidade` aplica na
   * auto-conferência (`scripts/db2`) — replicada aqui porque agora é o
   * mesmo cálculo, só que lendo Postgres em vez de db2.
   */
  it('qualidade: o PRIMEIRO bonus do union que traz Type 3 vence', () => {
    const primeiro = facetas({ bonusId: 1, quality: 3 });
    const segundo = facetas({ bonusId: 2, quality: 4 });

    expect(decodeBonuses([1, 2], dicionario(primeiro, segundo)).qualidade).toBe(3);
    expect(decodeBonuses([2, 1], dicionario(primeiro, segundo)).qualidade).toBe(4);
  });

  it('sem nenhum bonus de qualidade, fica null — cabe ao chamador cair pro item base', () => {
    expect(decodeBonuses([MYTH_4.bonusId], dicionario(MYTH_4)).qualidade).toBeNull();
  });
});
