import { parseSessionPaste } from '@titan/shared';
import type { LootCatalogRaid } from '@titan/shared';
import { LootCatalogPasteGeneratorService } from './loot-catalog-paste-generator.service';
import type { LootCatalogService } from './loot-catalog.service';

/** Um item de catálogo mínimo, só com o que o gerador olha. */
function item(itemId: number) {
  return {
    itemId,
    name: `Item ${itemId}`,
    icon: null,
    equipLoc: null,
    itemSubclass: null,
    primaryStats: [],
    usableBySpecs: [],
    specsCuratedAt: null,
  };
}

const RAID_COM_BOSS_CHEIO: LootCatalogRaid = {
  id: 'raid-1',
  slug: 'the-voidspire',
  name: 'The Voidspire',
  seasonId: 17,
  instanceMapId: 2912,
  encounters: [
    {
      id: 'enc-1',
      name: 'Chimaerus, the Undreamt God',
      position: 1,
      dungeonEncounterId: 3176,
      drops: [
        { difficulty: 'mythic', item: item(100) },
        { difficulty: 'mythic', item: item(101) },
        { difficulty: 'mythic', item: item(102) },
        { difficulty: 'mythic', item: item(103) },
        // Heroico tem só 2 — não é candidato válido nesta dificuldade.
        { difficulty: 'heroic', item: item(104) },
        { difficulty: 'heroic', item: item(105) },
      ],
    },
    {
      id: 'enc-2',
      name: 'Boss sem id de encounter',
      position: 2,
      dungeonEncounterId: null,
      drops: [
        { difficulty: 'mythic', item: item(200) },
        { difficulty: 'mythic', item: item(201) },
        { difficulty: 'mythic', item: item(202) },
      ],
    },
  ],
};

function montar(raids: LootCatalogRaid[]) {
  const catalog = { listRaids: () => Promise.resolve(raids) } as unknown as LootCatalogService;
  return new LootCatalogPasteGeneratorService(catalog);
}

describe('LootCatalogPasteGeneratorService', () => {
  it('gera uma colagem que o PRÓPRIO parseSessionPaste lê sem problema', async () => {
    const service = montar([RAID_COM_BOSS_CHEIO]);

    const paste = await service.gerarColagemAleatoria();
    const lido = parseSessionPaste(paste);

    expect(lido.problemas).toEqual([]);
    expect(lido.encounterId).toBe(3176);
    expect(lido.encounterName).toBe('Chimaerus, the Undreamt God');
    expect(lido.difficulty).toBe('mythic');
    expect(lido.instanceName).toBe('The Voidspire');
  });

  it('gera entre 3 e 6 itens, nunca mais do que o boss tem cadastrado', async () => {
    const service = montar([RAID_COM_BOSS_CHEIO]);

    for (let i = 0; i < 20; i++) {
      const lido = parseSessionPaste(await service.gerarColagemAleatoria());
      expect(lido.items.length).toBeGreaterThanOrEqual(3);
      expect(lido.items.length).toBeLessThanOrEqual(4); // só 4 drops mythic cadastrados
    }
  });

  it('nunca sorteia o boss sem dungeonEncounterId', async () => {
    const service = montar([RAID_COM_BOSS_CHEIO]);

    for (let i = 0; i < 20; i++) {
      const lido = parseSessionPaste(await service.gerarColagemAleatoria());
      expect(lido.encounterName).not.toBe('Boss sem id de encounter');
    }
  });

  it('nunca sorteia a dificuldade com menos de 3 drops (heroico, neste catálogo)', async () => {
    const service = montar([RAID_COM_BOSS_CHEIO]);

    for (let i = 0; i < 20; i++) {
      const lido = parseSessionPaste(await service.gerarColagemAleatoria());
      expect(lido.difficulty).toBe('mythic');
    }
  });

  it('recusa quando o catálogo não tem boss com itens suficientes', async () => {
    const raidVazia: LootCatalogRaid = { ...RAID_COM_BOSS_CHEIO, encounters: [] };
    const service = montar([raidVazia]);

    await expect(service.gerarColagemAleatoria()).rejects.toThrow(/pelo menos 3 itens/);
  });

  it('itens sem cadastro de nome/ícone ainda geram colagem válida', async () => {
    // O catálogo permite item enriquecido depois (Regra 6 do TIT-63) — o
    // gerador não pode depender de nome/ícone existirem.
    const service = montar([RAID_COM_BOSS_CHEIO]);
    const lido = parseSessionPaste(await service.gerarColagemAleatoria());

    expect(lido.items.every((i) => i.itemId > 0)).toBe(true);
  });
});
