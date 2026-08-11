import { describe, expect, it } from 'vitest';
import { LOOT_LINE_SOURCES, lootLineSchema } from './loot-line.js';
import { LOOT_RESPONSES } from './loot-response.js';
import { RAID_DIFFICULTIES } from './wow.js';

/**
 * Uma linha do jeito que ela sai do banco.
 *
 * Nomes fictícios de propósito: o export real tem gente de verdade, e o CLAUDE.md
 * proíbe versionar dado de membro.
 */
const linha = (over: Record<string, unknown> = {}) => ({
  id: 'ckline',
  source: LOOT_LINE_SOURCES.IMPORT_RC,
  awardedAt: '2026-03-19T23:12:00.000Z',
  winner: { name: 'Fulano', realm: 'Area 52', nameKey: 'fulano', realmSlug: 'area-52' },
  winnerClass: 'MAGE',
  looter: { name: 'Ciclano', realm: 'Azralon', nameKey: 'ciclano', realmSlug: 'azralon' },
  itemId: 249308,
  itemString: 'item:249308::::::::90:252::5:4:6652:13577:13334:12794',
  rawInstance: 'The Voidspire-Heroic',
  rawBoss: 'Fallen-King Salhadaar',
  encounterId: 'ckboss',
  difficulty: RAID_DIFFICULTIES.HEROIC,
  responseOptionSlug: LOOT_RESPONSES.BIS,
  votes: 2,
  note: null,
  ...over,
});

describe('lootLineSchema', () => {
  it('aceita uma linha completa', () => {
    expect(lootLineSchema.safeParse(linha()).success).toBe(true);
  });

  describe('o que pode faltar sem ser erro', () => {
    it('boss não resolvido é nulo, e a grafia da fonte fica', () => {
      // 22% do histórico importado não casa com o catálogo — nome traduzido ou
      // boss `Unknown`. Exigir o vínculo recusaria histórico legítimo.
      const lido = lootLineSchema.safeParse(
        linha({
          encounterId: null,
          rawBoss: 'Desconhecido',
          rawInstance: 'A Torre do Caos-Normal',
        }),
      );

      expect(lido.success).toBe(true);
    });

    it('dificuldade indeterminada é nula, nunca `normal` por omissão', () => {
      // O sufixo do `instance` é texto localizado e nem é enum: `Mythic -
      // Flexible Raiding`, `Piedra angular mítica`. Chutar seria inventar fato.
      expect(lootLineSchema.safeParse(linha({ difficulty: null })).success).toBe(true);
    });

    it('sem looter, sem classe e sem voto', () => {
      // Fonte que não tem o conceito. Voto ZERO é resultado, nulo é ausência.
      const lido = lootLineSchema.safeParse(
        linha({ looter: null, winnerClass: null, votes: null }),
      );

      expect(lido.success).toBe(true);
    });
  });

  describe('o que não pode faltar', () => {
    it('recusa personagem sem o par completo', () => {
      // Regra 6: sempre nome + realm. Nome sozinho colide — no roster existem 7
      // grupos que só diferem por acento, com ranks diferentes.
      expect(
        lootLineSchema.safeParse(linha({ winner: { name: 'Fulano', nameKey: 'fulano' } })).success,
      ).toBe(false);
    });

    it('recusa linha sem o bruto de onde veio', () => {
      // É o único caminho de volta quando alguém mapear os nomes traduzidos.
      expect(lootLineSchema.safeParse(linha({ rawInstance: undefined })).success).toBe(false);
      expect(lootLineSchema.safeParse(linha({ itemString: undefined })).success).toBe(false);
    });

    it('recusa voto negativo', () => {
      expect(lootLineSchema.safeParse(linha({ votes: -1 })).success).toBe(false);
    });
  });

  it('a resposta é slug livre, não enum fechado', () => {
    // As opções são tabela configurável: um enum aqui recusaria a opção que a
    // liderança cadastrar. Quem valida é a FK.
    expect(
      lootLineSchema.safeParse(linha({ responseOptionSlug: 'opcao-nova-da-lideranca' })).success,
    ).toBe(true);
    expect(lootLineSchema.safeParse(linha({ responseOptionSlug: '' })).success).toBe(false);
  });

  it('as três fontes têm identidade estável, nunca número', () => {
    expect(Object.values(LOOT_LINE_SOURCES).sort()).toEqual([
      'import_rc',
      'import_wowaudit',
      'live_session',
    ]);
  });
});
