import type { LootCatalogRepository } from '../loot-catalog/loot-catalog.repository';
import type { LootLinesService } from '../loot-lines/loot-lines.service';
import type { LootSessionsService } from '../loot-sessions/loot-sessions.service';
import type { WowDataRepository } from './wow-data.repository';
import { WowDataReportService } from './wow-data-report.service';

/** `itemString` real de raid (ver `item-string.spec.ts`), com bonus trocado. */
function itemString(...bonusIds: number[]): string {
  return `item:249308::::::::90:252::6:${bonusIds.length}:${bonusIds.join(':')}`;
}

function montar(dados: {
  historico?: Array<{ itemId: number; itemString: string }>;
  sessoes?: Array<{ itemId: number; itemString: string }>;
  idsConhecidos?: number[];
  idsComDadoNoBuild?: number[];
  itemIdsCatalogados?: number[];
  todosOsItensDoCatalogo?: number[];
  buildAtivo?: string | null;
}) {
  const wowData = {
    buildAtivo: jest.fn(() =>
      Promise.resolve(dados.buildAtivo === undefined ? '12.1.0.69299' : dados.buildAtivo),
    ),
    idsDeBonusConhecidos: jest.fn(() => Promise.resolve(new Set(dados.idsConhecidos ?? []))),
    idsDeItemNoBuild: jest.fn(() => Promise.resolve(new Set(dados.idsComDadoNoBuild ?? []))),
  };
  const lootLines = {
    listarItensParaRelatorioDeBonus: jest.fn(() => Promise.resolve(dados.historico ?? [])),
  };
  const lootSessions = {
    listarItensParaRelatorioDeBonus: jest.fn(() => Promise.resolve(dados.sessoes ?? [])),
  };
  const catalog = {
    findExistingItemIds: jest.fn(() => Promise.resolve(dados.itemIdsCatalogados ?? [])),
    findAllItemIds: jest.fn(() => Promise.resolve(dados.todosOsItensDoCatalogo ?? [])),
  };

  const service = new WowDataReportService(
    wowData as unknown as WowDataRepository,
    lootLines as unknown as LootLinesService,
    lootSessions as unknown as LootSessionsService,
    catalog as unknown as LootCatalogRepository,
  );

  return { service, catalog, wowData };
}

describe('WowDataReportService.gerar', () => {
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

    const relatorio = await service.gerar();

    expect(relatorio.bonusIds).toEqual([]);
    expect(relatorio.itemIds).toEqual([{ itemId: 1, ocorrencias: 1 }]);
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

  it('nada nas duas fontes devolve as listas vazias', async () => {
    const { service } = montar({});

    const relatorio = await service.gerar();

    expect(relatorio.bonusIds).toEqual([]);
    expect(relatorio.itemIds).toEqual([]);
    expect(relatorio.itensSemDadoNoBuild).toEqual([]);
  });

  /**
   * Antes da primeira ativação (TIT-140) o banco não tem build ativo. O
   * relatório dizendo "tudo desconhecido" é a verdade, e é exatamente o que se
   * quer ver nesse momento — não um caso de borda a esconder.
   */
  it('sem build (nem parâmetro, nem ativo), todo bonus do histórico aparece como desconhecido', async () => {
    const { service, wowData } = montar({
      historico: [{ itemId: 1, itemString: itemString(40, 12806) }],
      idsConhecidos: [40, 12806],
      buildAtivo: null,
    });

    const relatorio = await service.gerar();

    expect(wowData.idsDeBonusConhecidos).not.toHaveBeenCalled();
    expect(relatorio.build).toBeNull();
    expect(relatorio.bonusIds.map((b) => b.bonusId).sort((a, b) => a - b)).toEqual([40, 12806]);
  });

  /**
   * Sem build (nem parâmetro nem ativo), nenhum item do catálogo tem como ter
   * dado — o mesmo "tudo desconhecido" da pergunta de bonus, aplicado à
   * pergunta nova.
   */
  it('sem build, todo item do catálogo aparece como sem dado', async () => {
    const { service, wowData } = montar({
      todosOsItensDoCatalogo: [249276, 249277],
      buildAtivo: null,
    });

    const relatorio = await service.gerar();

    expect(wowData.idsDeItemNoBuild).not.toHaveBeenCalled();
    expect(relatorio.itensSemDadoNoBuild).toEqual([249276, 249277]);
  });

  it('item do catálogo com dado no build não aparece em itensSemDadoNoBuild', async () => {
    const { service } = montar({
      todosOsItensDoCatalogo: [249276, 249277, 249278],
      idsComDadoNoBuild: [249276, 249278],
    });

    const relatorio = await service.gerar();

    expect(relatorio.itensSemDadoNoBuild).toEqual([249277]);
  });

  /**
   * TIT-140: dá para conferir um build ANTES de ativá-lo (o PTR), sem
   * depender de qual build está ativo agora.
   */
  it('com build informado, confere ESSE build — não o ativo', async () => {
    const { service, wowData } = montar({
      todosOsItensDoCatalogo: [249276],
      idsComDadoNoBuild: [],
      buildAtivo: '12.1.0.69299',
    });

    const relatorio = await service.gerar('12.2.0.70000');

    expect(wowData.idsDeItemNoBuild).toHaveBeenCalledWith('12.2.0.70000');
    expect(wowData.idsDeBonusConhecidos).toHaveBeenCalledWith('12.2.0.70000');
    expect(relatorio.build).toBe('12.2.0.70000');
  });
});
