import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  RAID_DIFFICULTIES,
  raidDifficultyLevelSchema,
  SPEC_CLASS,
  SPECS,
  toCharacterKey,
  toSlug,
  wowSpecSchema,
} from './wow.js';

const TODAS_AS_SPECS = Object.values(SPECS);

describe('SPECS', () => {
  it('tem uma classe mapeada para cada spec', () => {
    // O Record já obriga isso no typecheck; o teste pega o caso em que alguém
    // acrescenta a spec na lista e "resolve" o erro com um valor errado.
    for (const spec of TODAS_AS_SPECS) {
      expect(CLASSES).toContain(SPEC_CLASS[spec]);
    }
  });

  it('cobre todas as classes', () => {
    // Classe sem nenhuma spec significa spec esquecida na lista — e um item
    // dessa classe ficaria sem ninguém elegível, sem erro nenhum.
    const comSpec = new Set(TODAS_AS_SPECS.map((s) => SPEC_CLASS[s]));
    expect([...CLASSES].filter((c) => !comSpec.has(c))).toEqual([]);
  });

  it('não tem slug repetido', () => {
    expect(new Set(TODAS_AS_SPECS).size).toBe(TODAS_AS_SPECS.length);
  });

  it('prefixa a classe, porque o nome sozinho colide', () => {
    // Os quatro pares que justificam o prefixo.
    for (const spec of [
      SPECS.DRUID_RESTORATION,
      SPECS.SHAMAN_RESTORATION,
      SPECS.PALADIN_HOLY,
      SPECS.PRIEST_HOLY,
      SPECS.MAGE_FROST,
      SPECS.DEATH_KNIGHT_FROST,
      SPECS.PALADIN_PROTECTION,
      SPECS.WARRIOR_PROTECTION,
    ]) {
      expect(wowSpecSchema.safeParse(spec).success).toBe(true);
    }

    // E o nome cru não é aceito.
    expect(wowSpecSchema.safeParse('restoration').success).toBe(false);
  });
});

describe('raidDifficultyLevelSchema', () => {
  it('aceita as três dificuldades que a guilda joga', () => {
    for (const d of Object.values(RAID_DIFFICULTIES)) {
      expect(raidDifficultyLevelSchema.parse(d)).toBe(d);
    }
  });

  it('recusa dificuldade não cadastrada', () => {
    // LFR ficou de fora de propósito. Aparecer aqui significa que alguém mandou
    // um valor que o resto do sistema não sabe tratar.
    expect(raidDifficultyLevelSchema.safeParse('lfr').success).toBe(false);
  });

  it('recusa valor posicional', () => {
    // A identidade é o rótulo, nunca o índice. O `responseID` do RCLootCouncil é
    // posicional e por isso o id 2 aparece como "Big" e como "Banking" no mesmo
    // export — a armadilha não se repete aqui.
    expect(raidDifficultyLevelSchema.safeParse(2).success).toBe(false);
  });
});

describe('toSlug', () => {
  it('normaliza caixa e espaços', () => {
    expect(toSlug('Burning Legion')).toBe('burning-legion');
    expect(toSlug('  Nome_Com Espaco ')).toBe('nome-com-espaco');
  });

  it('remove apóstrofos', () => {
    expect(toSlug("Cho'gall")).toBe('chogall');
    expect(toSlug('Cho’gall')).toBe('chogall');
  });

  it('remove acentos combinantes', () => {
    expect(toSlug('Área 52')).toBe('area-52');
    expect(toSlug('Ázràlon')).toBe('azralon');
  });

  /**
   * Casos tirados do roster real da Titan Inc (Azralon). É o cenário que
   * importa: quem digita o nome sem os caracteres especiais tem que casar com
   * o nome como está no roster.
   */
  describe('nomes reais do roster', () => {
    const casos: ReadonlyArray<readonly [rosterName: string, digitado: string]> = [
      ['Zécolmeia', 'Zecolmeia'],
      ['Åzurra', 'Azurra'],
      ['Dhärmä', 'Dharma'],
      ['Jöci', 'Joci'],
      // Este é o que estava quebrado: o ø não é decomposto pelo NFD.
      ['Håøkåh', 'Haokah'],
    ];

    for (const [rosterName, digitado] of casos) {
      it(`"${rosterName}" casa com "${digitado}"`, () => {
        expect(toSlug(rosterName)).toBe(toSlug(digitado));
      });
    }
  });

  it('transliteral letras latinas que o NFD não decompõe', () => {
    expect(toSlug('Håøkåh')).toBe('haokah');
    expect(toSlug('Æther')).toBe('aether');
    expect(toSlug('Strauß')).toBe('strauss');
    expect(toSlug('Øystein')).toBe('oystein');
    expect(toSlug('Þor')).toBe('thor');
  });

  it('é idempotente — aplicar duas vezes não muda o resultado', () => {
    // Importa porque o valor pode ser normalizado ao gravar e de novo ao ler.
    for (const nome of ['Håøkåh', 'Zécolmeia', "Cho'gall", 'Área 52']) {
      expect(toSlug(toSlug(nome))).toBe(toSlug(nome));
    }
  });
});

describe('toCharacterKey', () => {
  it('mantém acento — nomes acentuados são personagens DIFERENTES', () => {
    // Caso real do roster: três personagens distintos, ranks distintos.
    // Colapsar em "shrewd" faria o rank de um vazar para o outro.
    const chaves = new Set(['Shrëwd', 'Shrêwd', 'Shrèwd'].map(toCharacterKey));
    expect(chaves.size).toBe(3);
  });

  it('toSlug colapsaria os três — é por isso que esta função existe', () => {
    const chaves = new Set(['Shrëwd', 'Shrêwd', 'Shrèwd'].map(toSlug));
    expect(chaves.size).toBe(1);
  });

  it('normaliza capitalização', () => {
    expect(toCharacterKey('Zenithus')).toBe(toCharacterKey('zEnItHuS'));
  });

  it('trata as duas formas Unicode do mesmo acento como iguais', () => {
    // 'ë' pode vir composto (U+00EB) ou decomposto ('e' + U+0308). Sem NFC,
    // as duas formas não são iguais em ===, e o mesmo personagem viraria dois.
    expect(toCharacterKey('Shrëwd')).toBe(toCharacterKey('Shrëwd'));
  });

  it('ignora espaço em volta', () => {
    expect(toCharacterKey('  Joci  ')).toBe('joci');
  });
});
