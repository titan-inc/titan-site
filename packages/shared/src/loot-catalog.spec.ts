import { describe, expect, it } from 'vitest';
import { catalogItemSchema, catalogRaidSchema } from './loot-catalog.js';
import { PRIMARY_STATS, RAID_DIFFICULTIES, SPECS } from './wow.js';

// Os testes do vocabulário de dificuldade moraram aqui até ele mudar para o
// `wow.ts`, onde é o lugar dele — é conceito do jogo, não do catálogo. Ver
// `wow.spec.ts`.

describe('catalogItemSchema', () => {
  const cru = {
    itemId: 249276,
    name: null,
    icon: null,
    equipLoc: null,
    itemSubclass: null,
    primaryStats: [],
    usableBySpecs: [],
    specsCuratedAt: null,
  };

  it('aceita item ainda não enriquecido', () => {
    // Estado normal de item cadastrado antes do patch entrar: a API da Blizzard
    // responde 404 para item de patch não lançado, e o cadastro não pode esperar.
    const item = catalogItemSchema.parse(cru);

    expect(item.itemId).toBe(249276);
    expect(item.name).toBeNull();
  });

  it('recusa itemId zero ou negativo', () => {
    expect(catalogItemSchema.safeParse({ ...cru, itemId: 0 }).success).toBe(false);
  });

  it('aceita conjunto de stat primário, não só um valor', () => {
    // O trinket com força E agilidade é o caso que derruba "um stat por peça".
    const stats = [PRIMARY_STATS.STRENGTH, PRIMARY_STATS.AGILITY];
    const item = catalogItemSchema.parse({ ...cru, primaryStats: stats });

    expect(item.primaryStats).toEqual(stats);
  });

  it('distingue "ninguém revisou" de "nenhuma spec usa"', () => {
    // As duas têm usableBySpecs vazio, e significam coisas opostas. Sem o
    // carimbo, item recém-cadastrado apareceria como inútil para todo mundo.
    const naoRevisado = catalogItemSchema.parse(cru);
    const revisadoSemNinguem = catalogItemSchema.parse({
      ...cru,
      specsCuratedAt: '2026-08-09T00:00:00.000Z',
    });

    expect(naoRevisado.usableBySpecs).toEqual([]);
    expect(naoRevisado.specsCuratedAt).toBeNull();
    expect(revisadoSemNinguem.usableBySpecs).toEqual([]);
    expect(revisadoSemNinguem.specsCuratedAt).not.toBeNull();
  });

  it('recusa spec que não existe', () => {
    const r = catalogItemSchema.safeParse({ ...cru, usableBySpecs: ['warrior-holy'] });
    expect(r.success).toBe(false);
  });
});

describe('catalogRaidSchema', () => {
  const raid = (seasonId: number | null) => ({
    id: 'ckraid',
    slug: 'the-voidspire',
    name: 'The Voidspire',
    seasonId,
    instanceMapId: 2569,
    encounters: [
      {
        id: 'ckboss',
        name: 'Boss A',
        position: 0,
        dungeonEncounterId: 2687,
        drops: [
          {
            difficulty: RAID_DIFFICULTIES.MYTHIC,
            item: {
              itemId: 249276,
              name: 'Item de Teste',
              icon: 'inv_helm_plate_raidwarrior_a_01',
              equipLoc: 'INVTYPE_HEAD',
              itemSubclass: 'Plate',
              primaryStats: [PRIMARY_STATS.STRENGTH],
              usableBySpecs: [SPECS.WARRIOR_FURY, SPECS.PALADIN_PROTECTION],
              specsCuratedAt: '2026-08-09T00:00:00.000Z',
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

  it('aceita boss sem o id do jogo', () => {
    // Estado normal de boss cadastrado antes de alguém buscar o número no
    // Warcraft Logs. Nulo aqui significa "ainda não conferido", e o construtor
    // de sessão não vai conseguir casar a colagem com este boss até preencher.
    const base = raid(17);
    const semId = {
      ...base,
      encounters: base.encounters.map((e) => ({ ...e, dungeonEncounterId: null })),
    };

    const [boss] = catalogRaidSchema.parse(semId).encounters;
    expect(boss?.dungeonEncounterId).toBeNull();
  });
});
