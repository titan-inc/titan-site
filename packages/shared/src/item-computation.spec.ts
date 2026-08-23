import { describe, expect, it } from 'vitest';
import type { DecodedBonuses } from './bonus-decode.js';
import {
  ITEM_STATS_INDISPONIVEL,
  computeItemStats,
  type WowItemDataFacets,
} from './item-computation.js';
import type { LinhaEscala } from './item-formula.js';

/**
 * Fixtures mínimas — o formato é real (mesma forma de `WowItemData`/
 * `WowItemLevelScaling`), o conteúdo é inventado só pra exercitar cada ramo.
 * A prova contra números REAIS do jogo é o caminho separado descrito na
 * TIT-136 ("Como provar"), rodando a fixture de `docs/` pelo banco.
 */

function item(over: Partial<WowItemDataFacets> = {}): WowItemDataFacets {
  return {
    itemLevel: 289,
    quality: 4,
    inventoryType: 6, // waist
    material: 4, // plate
    bonding: 1,
    flags: [0, 0],
    statIds: [],
    statAllocs: [],
    socketAllocs: [],
    itemDelay: null,
    dmgVariance: null,
    flavor: null,
    itemSetId: null,
    budgetIndex: 1,
    scalingType: 'armor',
    armorModifier: null,
    effects: null,
    ...over,
  };
}

function decoded(over: Partial<DecodedBonuses> = {}): DecodedBonuses {
  return {
    itemLevel: null,
    track: null,
    sockets: 0,
    terciarios: [],
    statsAdicionados: [],
    binding: null,
    dificuldade: null,
    qualidade: null,
    desconhecidos: [],
    ...over,
  };
}

const escalaBase: LinhaEscala = {
  itemLevel: 289,
  budget: [0, 1000, 0, 0],
  damageReplaceStat: 0,
  damageSecondary: 0,
  crMult: { armor: 1, weapon: 1, trinket: 1, jewelry: 1 },
  stamMult: { armor: 1, weapon: 1, trinket: 1, jewelry: 1 },
  socketCost: 0,
  armorTotal: [0, 0, 0, 50],
  // Índice pela QUALIDADE (0..4) — o item de teste usa quality 4 por padrão.
  armorQuality: [0, 0, 0, 0, 2],
  armorShield: [0, 0, 0, 0, 100],
  dmgOneHand: [],
  dmgTwoHand: [],
  dmgOneHandCaster: [],
  dmgTwoHandCaster: [],
};

describe('computeItemStats — escala ausente', () => {
  it('sem escala pra ilvl, tudo lacuna, mas flavor sobrevive (passthrough puro)', () => {
    const resultado = computeItemStats(
      item({ flavor: 'Um texto qualquer.' }),
      decoded(),
      null,
      null,
    );

    expect(resultado.indisponivel).toBe(ITEM_STATS_INDISPONIVEL.SEM_ESCALA_PARA_ILVL);
    expect(resultado.primario).toBeNull();
    expect(resultado.secundarios).toEqual([]);
    expect(resultado.armadura).toBeNull();
    expect(resultado.flavor).toBe('Um texto qualquer.');
  });
});

describe('computeItemStats — stats', () => {
  it('primário fixo (Strength) vira uma linha com um tipo só', () => {
    const resultado = computeItemStats(
      item({ statIds: [4], statAllocs: [500], socketAllocs: [0] }),
      decoded(),
      escalaBase,
      null,
    );

    expect(resultado.primario).toEqual({ valor: 50, tipos: ['strength'] }); // budget[1]=1000, sem multiplicador
  });

  it('dois fixos ao mesmo tempo (statId 4 E 5): primário fica null, mas os dois aparecem em secundarios — Bubblefin Splash Guard', () => {
    const resultado = computeItemStats(
      item({ statIds: [4, 5], statAllocs: [500, 300], socketAllocs: [0, 0] }),
      decoded(),
      escalaBase,
      null,
    );

    expect(resultado.primario).toBeNull();
    expect(resultado.secundarios).toEqual([
      { nome: 'strength', valor: 50 },
      { nome: 'intellect', valor: 30 },
    ]);
  });

  it('primário flexível (71) vira uma linha com os três tipos possíveis', () => {
    const resultado = computeItemStats(
      item({ statIds: [71], statAllocs: [500], socketAllocs: [0] }),
      decoded(),
      escalaBase,
      null,
    );

    expect(resultado.primario).toEqual({
      valor: 50,
      tipos: ['strength', 'agility', 'intellect'],
    });
  });

  it('secundário do item e do bônus, mesmo statId, SOMA numa linha só', () => {
    // statId 32 = crit. Item traz 300, bônus traz mais 200 → 500 no total,
    // budget[1]=1000 → 50.
    const resultado = computeItemStats(
      item({ statIds: [32], statAllocs: [300], socketAllocs: [0] }),
      decoded({ statsAdicionados: [{ statId: 32, alocacao: 200 }] }),
      escalaBase,
      null,
    );

    expect(resultado.secundarios).toEqual([{ nome: 'crit', valor: 50 }]);
  });

  it('terciário sai do statsAdicionados do bônus (Type 2), nunca do ItemSparse do item', () => {
    const resultado = computeItemStats(
      item({ statIds: [7], statAllocs: [500], socketAllocs: [0] }), // stamina do item
      decoded({ statsAdicionados: [{ statId: 62, alocacao: 400 }] }), // leech do bônus
      escalaBase,
      null,
    );

    expect(resultado.terciarios).toEqual([{ tipo: 'leech', valor: 40 }]);
  });

  it('Indestructible calcula um número — a decisão de mostrar só a palavra é da tela', () => {
    const resultado = computeItemStats(
      item(),
      decoded({ statsAdicionados: [{ statId: 64, alocacao: 680 }] }),
      escalaBase,
      null,
    );

    expect(resultado.terciarios).toEqual([{ tipo: 'indestructible', valor: 68 }]);
  });
});

describe('computeItemStats — armadura, block e dano de arma', () => {
  it('peça de armadura normal usa o armorModifier já resolvido pelo gerador', () => {
    const resultado = computeItemStats(item({ armorModifier: 2 }), decoded(), escalaBase, null);
    expect(resultado.armadura).toBe(200); // floor(50 × 2 × 2 + 0.5)
    expect(resultado.block).toBeNull();
    expect(resultado.dano).toBeNull();
  });

  it('escudo tem armadura E block, pela tabela de escudo', () => {
    const resultado = computeItemStats(
      item({ inventoryType: 14, material: 0, armorModifier: null }),
      decoded(),
      escalaBase,
      null,
    );
    expect(resultado.armadura).toBe(100); // floor(100 + 0.5)
    expect(resultado.block).toBe(250); // floor(100 × 2.5)
  });

  it('arma sem itemDelay/dmgVariance não calcula dano (dado incompleto é lacuna)', () => {
    const resultado = computeItemStats(
      item({ inventoryType: 17, itemDelay: null, dmgVariance: 0.2 }),
      decoded(),
      escalaBase,
      null,
    );
    expect(resultado.dano).toBeNull();
  });

  it('arma de duas mãos calcula min/max/dps/velocidade', () => {
    const resultado = computeItemStats(
      item({
        inventoryType: 17,
        itemDelay: 3000,
        dmgVariance: 0.2,
        flags: [0, 0],
        material: 0,
        armorModifier: null,
      }),
      decoded(),
      { ...escalaBase, dmgTwoHand: [0, 0, 0, 0, 100] },
      null,
    );
    expect(resultado.dano).toEqual({ min: 270, max: 330, dps: 100, velocidade: 3 });
    expect(resultado.armadura).toBeNull(); // arma não tem armadura inata
  });
});

describe('computeItemStats — efeito', () => {
  it('renderiza o texto com o valor calculado na escala do drop', () => {
    const resultado = computeItemStats(
      item({
        effects: {
          spellId: 1,
          descricaoTemplate: 'Ganha $s1 de força.',
          duracaoMs: null,
          maxStacks: null,
          efeitos: [{ effectIndex: 0, coefficient: 1, scalingClass: -8 }],
        },
      }),
      decoded(),
      { ...escalaBase, damageReplaceStat: 105 },
      null,
    );

    expect(resultado.efeito).toEqual({
      textoRenderizado: 'Ganha 105 de força.',
      duracaoSegundos: null,
      maxStacks: null,
    });
  });

  it('sem effects no item, efeito é null — não é lacuna, a peça não tem', () => {
    const resultado = computeItemStats(item({ effects: null }), decoded(), escalaBase, null);
    expect(resultado.efeito).toBeNull();
    expect(resultado.indisponivel).toBeNull();
  });
});

describe('computeItemStats — itemLevel', () => {
  it('sem bônus de ilvl, cai pro base do WowItemData', () => {
    const resultado = computeItemStats(item({ itemLevel: 276 }), decoded(), escalaBase, null);
    expect(resultado.itemLevel).toBe(276);
  });

  it('bônus determina o ilvl — vence o base do item', () => {
    const resultado = computeItemStats(
      item({ itemLevel: 219 }), // base do token — o que sairia sem a árvore de bônus
      decoded({ itemLevel: 308 }),
      escalaBase,
      null,
    );
    expect(resultado.itemLevel).toBe(308);
  });

  it('sobrevive mesmo sem escala — é o mesmo passthrough do flavor', () => {
    const resultado = computeItemStats(item({ itemLevel: 289 }), decoded(), null, null);
    expect(resultado.itemLevel).toBe(289);
    expect(resultado.indisponivel).not.toBeNull();
  });
});

describe('computeItemStats — set', () => {
  it('com conjunto, devolve nome, total de peças e os bônus crus (sem texto)', () => {
    const resultado = computeItemStats(item({ itemSetId: 1978 }), decoded(), escalaBase, {
      itemSetId: 1978,
      name: "Relentless Rider's Lament",
      pieceItemIds: [1, 2, 3, 4, 5],
      bonuses: [{ chrSpecId: 250, threshold: 2, spellId: 999 }],
    });

    expect(resultado.set).toEqual({
      itemSetId: 1978,
      nome: "Relentless Rider's Lament",
      pecasTotal: 5,
      pecaItemIds: [1, 2, 3, 4, 5],
      bonusPorSpec: [{ chrSpecId: 250, threshold: 2, spellId: 999 }],
    });
  });

  it('item sem itemSetId (ou set não resolvido pelo chamador) devolve null', () => {
    expect(computeItemStats(item({ itemSetId: null }), decoded(), escalaBase, null).set).toBeNull();
  });
});

describe('computeItemStats — vínculo', () => {
  it('bit 27 do Flags[0] vence o Bonding — Binds to Warband', () => {
    const resultado = computeItemStats(
      item({ bonding: 1, flags: [1 << 27, 0] }),
      decoded(),
      escalaBase,
      null,
    );
    expect(resultado.vinculo).toBe('warband');
  });

  it('o override do bônus (Type 46) vence tudo', () => {
    const resultado = computeItemStats(
      item({ bonding: 1, flags: [0, 0] }),
      decoded({ binding: 'warbound_until_equipped' }),
      escalaBase,
      null,
    );
    expect(resultado.vinculo).toBe('warbound_until_equipped');
  });
});

describe('computeItemStats — qualidade', () => {
  it('override do bônus (Type 3) muda a linha de armadura, mesmo item e mesma escala', () => {
    const escalaComDuasQualidades = { ...escalaBase, armorQuality: [0, 0, 0, 5, 9] };

    const semOverride = computeItemStats(
      item({ quality: 3, armorModifier: 2 }), // sem override, usa o índice 3 (base)
      decoded(),
      escalaComDuasQualidades,
      null,
    );
    const comOverride = computeItemStats(
      item({ quality: 3, armorModifier: 2 }), // mesmo item — só o override muda
      decoded({ qualidade: 4 }),
      escalaComDuasQualidades,
      null,
    );

    expect(semOverride.armadura).toBe(500); // floor(50 × 5 × 2 + 0.5), índice 3
    expect(comOverride.armadura).toBe(900); // floor(50 × 9 × 2 + 0.5), índice 4
  });
});
