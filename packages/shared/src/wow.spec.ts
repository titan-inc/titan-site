import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  RAID_DIFFICULTIES,
  raidDifficultyLevelSchema,
  SPEC_CLASS,
  SPECS,
  toCharacterKey,
  toEncounterMatchKey,
  toRealmMatchKey,
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

describe('toEncounterMatchKey', () => {
  it('casa o boss entre o Encounter Journal e o Warcraft Logs', () => {
    // O caso real: o journal escreve sem vírgula e o WCL com. Em 09/08/2026 essa
    // vírgula reprovou a carga de The Dreamrift com um id CORRETO, vindo do
    // cliente do WoW.
    expect(toEncounterMatchKey('Chimaerus the Undreamt God')).toBe(
      toEncounterMatchKey('Chimaerus, the Undreamt God'),
    );
  });

  it('não afrouxa a verificação: boss diferente continua diferente', () => {
    // É o ponto todo da conferência — id apontando para outro boss tem que
    // reprovar. Foi assim que um id errado de Aberrus foi pego.
    expect(toEncounterMatchKey('Kazzara, the Hellforged')).not.toBe(
      toEncounterMatchKey('The Forgotten Experiments'),
    );
  });

  it('colapsa hífen e apóstrofo, que é onde as fontes mais divergem', () => {
    // Nomes reais do tier corrente. Não invento divergência que não observei —
    // estes dois caracteres são os que aparecem nos bosses de verdade.
    expect(toEncounterMatchKey('Fallen-King Salhadaar')).toBe(
      toEncounterMatchKey('Fallen King Salhadaar'),
    );
    expect(toEncounterMatchKey("Artificer Xy'mox")).toBe(toEncounterMatchKey('Artificer Xymox'));
  });
});

describe('toRealmMatchKey', () => {
  it('casa o realm composto entre Warcraft Logs e WoWAudit', () => {
    // O caso real: o WCL escreve "Area52" e "DemonSoul"; a Blizzard e o
    // WoWAudit escrevem "Area 52" e "Demon Soul".
    expect(toRealmMatchKey('Area52')).toBe(toRealmMatchKey('Area 52'));
    expect(toRealmMatchKey('DemonSoul')).toBe(toRealmMatchKey('Demon Soul'));
  });

  it('casa também com o slug que a Blizzard usa na URL', () => {
    expect(toRealmMatchKey('area-52')).toBe(toRealmMatchKey('Area 52'));
  });

  it('toSlug NÃO casa esses pares — é por isso que esta função existe', () => {
    // Sem ela, quem raidou de Area52 seria gravado como "Não Raidou".
    expect(toSlug('Area52')).not.toBe(toSlug('Area 52'));
    expect(toSlug('DemonSoul')).not.toBe(toSlug('Demon Soul'));
  });

  it('não junta realms diferentes', () => {
    // Verificado contra o índice da Blizzard: 344 realms US, 344 chaves.
    const chaves = new Set(
      ['Area 52', 'Azralon', 'Demon Soul', 'Illidan', 'Sargeras', 'Stormrage'].map(toRealmMatchKey),
    );
    expect(chaves.size).toBe(6);
  });

  it('é idempotente', () => {
    for (const realm of ['Area 52', 'Demon Soul', 'Tol Barad']) {
      expect(toRealmMatchKey(toRealmMatchKey(realm))).toBe(toRealmMatchKey(realm));
    }
  });
});
