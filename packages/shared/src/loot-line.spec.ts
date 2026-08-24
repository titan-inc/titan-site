import { describe, expect, it } from 'vitest';
import { LOOT_LINE_SOURCES, lootLineSchema } from './loot-line.js';
import { LOOT_RESPONSE_KINDS, LOOT_RESPONSES } from './loot-response.js';
import { RAID_DIFFICULTIES } from './wow.js';

/**
 * Uma linha do jeito que ela sai do banco.
 *
 * Ids fictícios de propósito: o export real tem gente de verdade, e o CLAUDE.md
 * proíbe versionar dado de membro.
 */
const linha = (over: Record<string, unknown> = {}) => ({
  id: 'ckline',
  source: LOOT_LINE_SOURCES.IMPORT_RC,
  externalId: '1774483920-3',
  sessionId: null,
  awardedAt: '2026-03-19T23:12:00.000Z',
  awardedByUserId: null,
  awardedByBattletag: null,
  seasonId: 17,
  winnerCharacterId: 'char-fulano',
  looterCharacterId: 'char-ciclano',
  itemId: 249308,
  itemString: 'item:249308::::::::90:252::5:4:6652:13577:13334:12794',
  encounterId: 'ckboss',
  difficulty: RAID_DIFFICULTIES.HEROIC,
  responseOptionSlug: LOOT_RESPONSES.BIS,
  responseKind: LOOT_RESPONSE_KINDS.PLAYER,
  votes: 2,
  playerNote: null,
  councilNote: null,
  rawImportedLine: { id: '1774483920-3', player: 'Fulano-Area52' },
  ...over,
});

describe('lootLineSchema', () => {
  it('aceita uma linha completa', () => {
    expect(lootLineSchema.safeParse(linha()).success).toBe(true);
  });

  describe('o que pode faltar sem ser erro', () => {
    it('boss não resolvido é nulo — sem bruto próprio, só o rawImportedLine', () => {
      // 22% do histórico importado não casa com o catálogo — nome traduzido ou
      // boss `Unknown`. Exigir o vínculo recusaria histórico legítimo.
      const lido = lootLineSchema.safeParse(linha({ encounterId: null }));

      expect(lido.success).toBe(true);
    });

    it('dificuldade indeterminada é nula, nunca `normal` por omissão', () => {
      // O sufixo do `instance` original é texto localizado e nem é enum: chutar
      // seria inventar fato. A dificuldade vem do itemContext, e às vezes ele
      // não diz.
      expect(lootLineSchema.safeParse(linha({ difficulty: null })).success).toBe(true);
    });

    it('sem looter e sem voto', () => {
      // Fonte que não tem o conceito. Voto ZERO é resultado, nulo é ausência.
      expect(
        lootLineSchema.safeParse(linha({ looterCharacterId: null, votes: null })).success,
      ).toBe(true);
    });

    it('sessão, quem awardou e a season faltam só no import', () => {
      expect(
        lootLineSchema.safeParse(
          linha({
            sessionId: null,
            awardedByUserId: null,
            awardedByBattletag: null,
            seasonId: null,
          }),
        ).success,
      ).toBe(true);
    });

    it('councilNote falta quando não houve — nasce só com a sessão ao vivo', () => {
      expect(lootLineSchema.safeParse(linha({ councilNote: null })).success).toBe(true);
    });

    it('rawImportedLine falta na sessão ao vivo, que nasce no nosso formato', () => {
      expect(
        lootLineSchema.safeParse(
          linha({ source: LOOT_LINE_SOURCES.LIVE_SESSION, rawImportedLine: null }),
        ).success,
      ).toBe(true);
    });
  });

  describe('o que não pode faltar', () => {
    it('recusa linha sem externalId', () => {
      // Sem ele não há trava de duplicata — nem para reimportar o mesmo
      // arquivo, nem para o encerramento de sessão não duplicar (TIT-69).
      expect(lootLineSchema.safeParse(linha({ externalId: undefined })).success).toBe(false);
      expect(lootLineSchema.safeParse(linha({ externalId: '' })).success).toBe(false);
    });

    it('recusa linha sem quem levou', () => {
      expect(lootLineSchema.safeParse(linha({ winnerCharacterId: undefined })).success).toBe(false);
    });

    it('recusa voto negativo', () => {
      expect(lootLineSchema.safeParse(linha({ votes: -1 })).success).toBe(false);
    });

    it('recusa linha sem responseKind — nunca fica em aberto', () => {
      // É o que distingue peça entregue ao jogador de peça que foi pro banco;
      // sem valor, a distinção simplesmente não existe.
      expect(lootLineSchema.safeParse(linha({ responseKind: undefined })).success).toBe(false);
      expect(lootLineSchema.safeParse(linha({ responseKind: 'banking' })).success).toBe(false);
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

  it('o responseKind É fechado — três valores, e só a Prisma acrescenta', () => {
    expect(Object.values(LOOT_RESPONSE_KINDS).sort()).toEqual(['loot_master', 'player', 'sistema']);
  });

  it('as três fontes têm identidade estável, nunca número', () => {
    expect(Object.values(LOOT_LINE_SOURCES).sort()).toEqual([
      'import_rc',
      'import_wowaudit',
      'live_session',
    ]);
  });
});
