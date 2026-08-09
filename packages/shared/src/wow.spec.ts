import { describe, expect, it } from 'vitest';
import { toCharacterKey, toRealmMatchKey, toSlug } from './wow.js';

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
