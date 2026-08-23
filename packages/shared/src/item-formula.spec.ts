import { describe, expect, it } from 'vitest';
import {
  arredondamentoBanqueiro,
  calcularArmadura,
  calcularBlock,
  calcularDanoDeArma,
  calcularEscalaDoEfeito,
  calcularValorEfeito,
  calcularValorStat,
  ehStatPrimario,
  renderizarTexto,
  resolverBudgetIndex,
  resolverMaterial,
  resolverTabelaDano,
  resolverTipoOrcamento,
  resolverVinculo,
  type LinhaEscala,
} from './item-formula.js';

/** Escala mínima só com os campos que cada teste precisa — os demais ficam
 * zerados, porque `Pick<>` nos parâmetros das funções já deixa claro o que
 * cada uma lê. */
function escala(parcial: Partial<LinhaEscala>): LinhaEscala {
  return {
    itemLevel: 0,
    budget: [],
    damageReplaceStat: 0,
    damageSecondary: 0,
    crMult: { armor: 1, weapon: 1, trinket: 1, jewelry: 1 },
    stamMult: { armor: 1, weapon: 1, trinket: 1, jewelry: 1 },
    socketCost: 0,
    armorTotal: [],
    armorQuality: [],
    armorShield: [],
    dmgOneHand: [],
    dmgTwoHand: [],
    dmgOneHandCaster: [],
    dmgTwoHandCaster: [],
    ...parcial,
  };
}

describe('arredondamentoBanqueiro', () => {
  it('meio exato vai pro par mais próximo', () => {
    expect(arredondamentoBanqueiro(2.5)).toBe(2);
    expect(arredondamentoBanqueiro(3.5)).toBe(4);
  });

  it('fora do meio arredonda normal', () => {
    expect(arredondamentoBanqueiro(2.4)).toBe(2);
    expect(arredondamentoBanqueiro(2.6)).toBe(3);
  });
});

describe('calcularValorStat', () => {
  it('primário não recebe multiplicador nenhum', () => {
    // statId 4 = Strength. budget[3]=1000, alocação 500 → cru = 50, sem crMult.
    const e = escala({
      budget: [0, 0, 0, 1000],
      crMult: { armor: 2, weapon: 2, trinket: 2, jewelry: 2 },
    });
    expect(calcularValorStat(4, 500, 0, 3, 'armor', e)).toBe(50);
  });

  it('secundário recebe o crMult do tipo de orçamento', () => {
    // statId 32 = Crit. budget[1]=1000, alocação 500 → cru 50 × crMult.weapon 2 = 100.
    const e = escala({
      budget: [0, 1000],
      crMult: { armor: 1, weapon: 2, trinket: 1, jewelry: 1 },
    });
    expect(calcularValorStat(32, 500, 0, 1, 'weapon', e)).toBe(100);
  });

  it('stamina usa stamMult, não crMult', () => {
    const e = escala({
      budget: [1000],
      crMult: { armor: 5, weapon: 5, trinket: 5, jewelry: 5 },
      stamMult: { armor: 3, weapon: 3, trinket: 3, jewelry: 3 },
    });
    expect(calcularValorStat(7, 500, 0, 0, 'armor', e)).toBe(150); // 50 × 3, não × 5.
  });

  it('alocação de socket vira penalty, subtraído antes do multiplicador', () => {
    const e = escala({ budget: [1000], socketCost: 10 });
    // cru = 500×1000/10000 − round_banqueiro(1×10) = 50 − 10 = 40.
    expect(calcularValorStat(32, 500, 1, 0, 'armor', e)).toBe(40);
  });
});

describe('ehStatPrimario', () => {
  it('fixos (Str/Agi/Int) e os quatro flexíveis são primário', () => {
    for (const id of [3, 4, 5, 71, 72, 73, 74]) expect(ehStatPrimario(id)).toBe(true);
  });

  it('secundário e terciário não são primário', () => {
    for (const id of [7, 32, 36, 40, 49, 61, 62, 63, 64]) expect(ehStatPrimario(id)).toBe(false);
  });
});

describe('resolverBudgetIndex / resolverTipoOrcamento', () => {
  it('mapeia os slots documentados', () => {
    expect(resolverBudgetIndex(17)).toBe(0); // 2H
    expect(resolverBudgetIndex(12)).toBe(1); // trinket
    expect(resolverBudgetIndex(9)).toBe(2); // pulso
    expect(resolverBudgetIndex(14)).toBe(3); // escudo

    expect(resolverTipoOrcamento(2)).toBe('jewelry'); // pescoço
    expect(resolverTipoOrcamento(12)).toBe('trinket');
    expect(resolverTipoOrcamento(17)).toBe('weapon');
    expect(resolverTipoOrcamento(14)).toBe('weapon'); // escudo segue a coluna Weapon
    expect(resolverTipoOrcamento(5)).toBe('armor');
  });

  it('InventoryType sem idx conhecido estoura — não existe orçamento pra chutar', () => {
    expect(() => resolverBudgetIndex(0)).toThrow();
  });
});

describe('resolverMaterial', () => {
  it('1..4 é o material de armadura; qualquer outro (token, joia, arma) é 0', () => {
    expect(resolverMaterial(1)).toBe(1);
    expect(resolverMaterial(4)).toBe(4);
    expect(resolverMaterial(0)).toBe(0);
    expect(resolverMaterial(7)).toBe(0);
  });
});

describe('calcularArmadura', () => {
  it('escudo usa a tabela de escudo, não o armorModifier', () => {
    const e = escala({ armorShield: [0, 0, 0, 100] });
    // floor(100 + 0.5) = 100.
    expect(calcularArmadura(0, 14, 3, e, null)).toBe(100);
  });

  it('slot de armadura normal: total × qualidade × armorModifier (já resolvido pelo gerador)', () => {
    const e = escala({ armorTotal: [0, 0, 0, 50], armorQuality: [0, 0, 0, 2] });
    // material 4 (plate) no peito (5), armorModifier 2: floor(50 × 2 × 2 + 0.5) = 200.
    expect(calcularArmadura(4, 5, 3, e, 2)).toBe(200);
  });

  it('material 0 (token/joia/arma) não tem armadura inata', () => {
    expect(calcularArmadura(0, 5, 3, escala({}), 2)).toBeNull();
  });

  it('armorModifier nulo (slot fora do ArmorLocation — trinket, dedo, pescoço) não tem armadura', () => {
    expect(calcularArmadura(4, 12, 3, escala({}), null)).toBeNull();
  });
});

describe('calcularBlock', () => {
  it('é discriminante contra round: só floor fecha', () => {
    // O espécime real (Bubblefin Splash Guard): armorShield 1052,271 × 2,5 = 2630,6775.
    const e = escala({ armorShield: [0, 0, 0, 1052.271] });
    expect(calcularBlock(3, e)).toBe(2630); // floor, não 2631.
  });
});

describe('resolverTabelaDano', () => {
  it('2H sem bit de caster é dmgTwoHand', () => {
    expect(resolverTabelaDano(17, [0, 0])).toBe('dmgTwoHand');
  });

  it('2H com o bit 0x200 no SEGUNDO elemento é dmgTwoHandCaster', () => {
    expect(resolverTabelaDano(17, [0, 0x200])).toBe('dmgTwoHandCaster');
  });

  it('1H (principal, mão secundária ou genérico) sem caster é dmgOneHand', () => {
    expect(resolverTabelaDano(13, [0, 0])).toBe('dmgOneHand');
    expect(resolverTabelaDano(21, [0, 0])).toBe('dmgOneHand');
    expect(resolverTabelaDano(22, [0, 0])).toBe('dmgOneHand');
  });

  it('InventoryType que não é arma não tem tabela', () => {
    expect(resolverTabelaDano(5, [0, 0])).toBeNull();
  });
});

describe('calcularDanoDeArma', () => {
  it('min é floor, max é floor com +0,5, dps arredonda a 1 casa', () => {
    const e = escala({ dmgOneHand: [0, 0, 0, 100] });
    // speed 3.0s, variância 0,2: min = floor(100×3×0,9) = 270; max = floor(100×3×1,1+0,5) = 330.
    const dano = calcularDanoDeArma('dmgOneHand', 3, 3000, 0.2, e);
    expect(dano).toEqual({ min: 270, max: 330, dps: 100 });
  });
});

describe('calcularEscalaDoEfeito / calcularValorEfeito', () => {
  it('scalingClass -8 usa damageReplaceStat', () => {
    const e = escala({ damageReplaceStat: 42, damageSecondary: 99, budget: [1] });
    expect(calcularEscalaDoEfeito(-8, e)).toBe(42);
  });

  it('scalingClass 0 e -9 usam damageSecondary', () => {
    const e = escala({ damageSecondary: 77 });
    expect(calcularEscalaDoEfeito(0, e)).toBe(77);
    expect(calcularEscalaDoEfeito(-9, e)).toBe(77);
  });

  it('qualquer outro cai no budget[0]', () => {
    const e = escala({ budget: [55] });
    expect(calcularEscalaDoEfeito(-1, e)).toBe(55);
  });

  it('é round, não floor — o segundo rank do trinket desfez a ambiguidade', () => {
    const e = escala({ damageSecondary: 25.999 });
    // coefficient × escala = 3068,988... arredonda pra 3069, floor daria 3068.
    expect(calcularValorEfeito(118.043, 0, e)).toBe(3069);
  });
});

describe('renderizarTexto', () => {
  it('substitui $sN, $d (em segundos) e $u; ignora placeholder sem fonte', () => {
    const texto = renderizarTexto(
      {
        descricaoTemplate: 'Ganha $s1 de força por $d, empilha até $u vezes. $w1 ignorado.',
        duracaoMs: 20000,
        maxStacks: 6,
      },
      new Map([[0, 105]]),
    );
    expect(texto).toBe('Ganha 105 de força por 20 sec, empilha até 6 vezes. $w1 ignorado.');
  });
});

describe('resolverVinculo', () => {
  it("bit 27 vence o Bonding — Mural/Hex Lord's Visage: Bonding 1 mas Warband", () => {
    expect(resolverVinculo(1, [1 << 27], null)).toBe('warband');
  });

  it('sem bit 27, Bonding 1 é bind_on_pickup', () => {
    expect(resolverVinculo(1, [0], null)).toBe('bind_on_pickup');
  });

  it('sem bit 27, Bonding 2 é bind_on_equip', () => {
    expect(resolverVinculo(2, [0], null)).toBe('bind_on_equip');
  });

  it("o override do bônus (Type 46) vence tudo, mesmo com bit 27 desligado — Pyrewalker's Doublet", () => {
    expect(resolverVinculo(1, [0], 'warbound_until_equipped')).toBe('warbound_until_equipped');
  });

  it('Bonding cru fora de {1,2} sem override é lacuna, nunca um chute', () => {
    expect(resolverVinculo(4, [0], null)).toBeNull();
  });
});
