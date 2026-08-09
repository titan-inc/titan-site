import { describe, expect, it } from 'vitest';
import { catalogItemSchema, catalogRaidSchema, raidDifficultyLevelSchema } from './loot-catalog.js';

describe('raidDifficultyLevelSchema', () => {
  it('aceita as três dificuldades que a guilda joga', () => {
    for (const d of ['normal', 'heroic', 'mythic']) {
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

describe('catalogItemSchema', () => {
  it('aceita item ainda não enriquecido', () => {
    // Estado normal de item cadastrado antes do patch entrar: a API da Blizzard
    // responde 404 para item de patch não lançado, e o cadastro não pode esperar.
    const item = catalogItemSchema.parse({
      itemId: 249276,
      name: null,
      icon: null,
      equipLoc: null,
      itemSubclass: null,
    });

    expect(item.itemId).toBe(249276);
    expect(item.name).toBeNull();
  });

  it('recusa itemId zero ou negativo', () => {
    expect(catalogItemSchema.safeParse({ itemId: 0 }).success).toBe(false);
  });
});

describe('catalogRaidSchema', () => {
  const raid = (seasonId: number | null) => ({
    id: 'ckraid',
    slug: 'the-voidspire',
    name: 'The Voidspire',
    seasonId,
    encounters: [
      {
        id: 'ckboss',
        name: 'Boss A',
        position: 0,
        drops: [
          {
            difficulty: 'mythic',
            item: {
              itemId: 249276,
              name: 'Item de Teste',
              icon: 'inv_helm_plate_raidwarrior_a_01',
              equipLoc: 'INVTYPE_HEAD',
              itemSubclass: 'Plate',
            },
          },
        ],
      },
    ],
  });

  it('aceita raid sem season', () => {
    // Nulo é estado legítimo, não dado faltando: a GameSeason só existe depois
    // que a season começa, e o catálogo é cadastrado antes disso.
    expect(catalogRaidSchema.parse(raid(null)).seasonId).toBeNull();
  });

  it('aceita raid já ligada à season', () => {
    expect(catalogRaidSchema.parse(raid(17)).seasonId).toBe(17);
  });
});
