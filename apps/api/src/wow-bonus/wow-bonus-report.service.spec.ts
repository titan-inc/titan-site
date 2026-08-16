import type { LootCatalogRepository } from '../loot-catalog/loot-catalog.repository';
import type { LootLinesService } from '../loot-lines/loot-lines.service';
import type { LootSessionsService } from '../loot-sessions/loot-sessions.service';
import type { WowBonusRepository } from './wow-bonus.repository';
import { WowBonusReportService } from './wow-bonus-report.service';

/** `itemString` real de raid (ver `item-string.spec.ts`), com bonus trocado. */
function itemString(...bonusIds: number[]): string {
  return `item:249308::::::::90:252::6:${bonusIds.length}:${bonusIds.join(':')}`;
}

function montar(dados: {
  historico?: Array<{ itemId: number; itemString: string }>;
  sessoes?: Array<{ itemId: number; itemString: string }>;
  idsConhecidos?: number[];
  itemIdsCatalogados?: number[];
}) {
  const bonuses = {
    findAllIds: jest.fn(() => Promise.resolve(new Set(dados.idsConhecidos ?? []))),
  };
  const lootLines = {
    listarItensParaRelatorioDeBonus: jest.fn(() => Promise.resolve(dados.historico ?? [])),
  };
  const lootSessions = {
    listarItensParaRelatorioDeBonus: jest.fn(() => Promise.resolve(dados.sessoes ?? [])),
  };
  const catalog = {
    findExistingItemIds: jest.fn(() => Promise.resolve(dados.itemIdsCatalogados ?? [])),
  };

  const service = new WowBonusReportService(
    bonuses as unknown as WowBonusRepository,
    lootLines as unknown as LootLinesService,
    lootSessions as unknown as LootSessionsService,
    catalog as unknown as LootCatalogRepository,
  );

  return { service, catalog };
}

describe('WowBonusReportService.gerar', () => {
  it('bonus desconhecido some quando está no dicionário, e sobra o resto — ordenado por frequência', async () => {
    const { service } = montar({
      historico: [
        { itemId: 1, itemString: itemString(40, 9999) }, // 40 conhecido, 9999 não
        { itemId: 1, itemString: itemString(9999) },
        { itemId: 1, itemString: itemString(9999, 8888) },
      ],
      idsConhecidos: [40],
    });

    const relatorio = await service.gerar();

    expect(relatorio.bonusIds).toEqual([
      { bonusId: 9999, ocorrencias: 3 },
      { bonusId: 8888, ocorrencias: 1 },
    ]);
  });

  it('junta linhas do histórico E das sessões', async () => {
    const { service } = montar({
      historico: [{ itemId: 1, itemString: itemString(111) }],
      sessoes: [{ itemId: 1, itemString: itemString(111) }],
    });

    const relatorio = await service.gerar();

    expect(relatorio.bonusIds).toEqual([{ bonusId: 111, ocorrencias: 2 }]);
  });

  it('itemString ilegível é ignorado, não estoura o relatório', async () => {
    const { service } = montar({
      historico: [{ itemId: 1, itemString: 'lixo-sem-item-id' }],
    });

    await expect(service.gerar()).resolves.toEqual({
      bonusIds: [],
      itemIds: [{ itemId: 1, ocorrencias: 1 }],
    });
  });

  it('itemId já catalogado não aparece no relatório', async () => {
    const { service, catalog } = montar({
      historico: [
        { itemId: 249276, itemString: itemString() },
        { itemId: 999999, itemString: itemString() },
      ],
      itemIdsCatalogados: [249276],
    });

    const relatorio = await service.gerar();

    expect(catalog.findExistingItemIds).toHaveBeenCalledWith([249276, 999999]);
    expect(relatorio.itemIds).toEqual([{ itemId: 999999, ocorrencias: 1 }]);
  });

  it('itemId não catalogado é ordenado por frequência', async () => {
    const { service } = montar({
      historico: [
        { itemId: 1, itemString: itemString() },
        { itemId: 2, itemString: itemString() },
        { itemId: 2, itemString: itemString() },
      ],
    });

    const relatorio = await service.gerar();

    expect(relatorio.itemIds).toEqual([
      { itemId: 2, ocorrencias: 2 },
      { itemId: 1, ocorrencias: 1 },
    ]);
  });

  it('nada nas duas fontes devolve as duas listas vazias', async () => {
    const { service } = montar({});

    await expect(service.gerar()).resolves.toEqual({ bonusIds: [], itemIds: [] });
  });
});
