import { BadRequestException } from '@nestjs/common';
import type { CatalogFile } from '@titan/shared';
import type { AttendanceService } from '../attendance/attendance.service';
import type { BlizzardService } from '../blizzard/blizzard.service';
import type { LootCatalogGeneratorService } from '../loot-catalog/loot-catalog-generator.service';
import type { LootCatalogPasteGeneratorService } from '../loot-catalog/loot-catalog-paste-generator.service';
import type { LootCatalogService } from '../loot-catalog/loot-catalog.service';
import type { RcImportService } from '../loot-lines/rc-import.service';
import type {
  LootSessionDummiesService,
  ResultadoRodarDummies,
} from '../loot-sessions/loot-session-dummies.service';
import type { LootSessionsService } from '../loot-sessions/loot-sessions.service';
import type { RaidProgressService } from '../raidprogress/raidprogress.service';
import type { SnapshotsService } from '../snapshots/snapshots.service';
import type {
  WowDataActivateResult,
  WowDataLoaderService,
  WowDataLoadResult,
} from '../wow-data/wow-data-loader.service';
import type {
  RelatorioDeDesconhecidos,
  WowDataReportService,
} from '../wow-data/wow-data-report.service';
import { OpsController } from './ops.controller';
import type { FixCharacterIdsResult, OpsService } from './ops.service';

describe('OpsController', () => {
  const snapshots = {
    takeSnapshot: jest.fn(() => Promise.resolve({ status: 'ok' })),
    backfillSeasonKeys: jest.fn(() => Promise.resolve({ periods: 3, entries: 10 })),
  };
  const attendance = {
    sync: jest.fn<Promise<{ synced: number }>, [Date | undefined]>(() =>
      Promise.resolve({ synced: 1 }),
    ),
  };
  const blizzard = {
    getJournalInstanceIndex: jest.fn(() =>
      Promise.resolve([
        { id: 10, name: 'Zona Antiga' },
        { id: 1307, name: 'The Voidspire' },
      ]),
    ),
  };
  const catalogGenerator = { gerar: jest.fn(() => Promise.resolve({ slug: 'the-voidspire' })) };
  const catalogService = {
    carregarArquivo: jest.fn(() => Promise.resolve({ bosses: 8, itens: 40, drops: 120 })),
    listarItemIdsCatalogados: jest.fn(() => Promise.resolve([249276, 249277])),
  };
  const raidProgress = {
    getReport: jest.fn(() => Promise.resolve({ season: { id: 17 } })),
  };
  const rcImport = {
    importar: jest.fn(() =>
      Promise.resolve({
        lidos: 445,
        gravados: 294,
        descartados: 151,
        bossResolvido: 238,
        bossNaoResolvido: 56,
        semDificuldade: 0,
      }),
    ),
  };
  const ops = {
    probeRoster: jest.fn(() => Promise.resolve({ guild: 'Titan Inc' })),
    checkOauth: jest.fn(() => Promise.resolve({ ok: true, stale: false })),
    fixCharacterIds: jest.fn<Promise<FixCharacterIdsResult>, []>(() =>
      Promise.resolve({ corrigidos: 0, trocas: [] }),
    ),
  };
  const lootSessions = {
    regerarHistorico: jest.fn<Promise<number>, [string]>(() => Promise.resolve(0)),
  };
  const pasteGenerator = {
    gerarColagemAleatoria: jest.fn(() => Promise.resolve('TILC/1\t...')),
  };
  const dummies = {
    rodar: jest.fn<Promise<ResultadoRodarDummies>, [string, number | undefined]>(() =>
      Promise.resolve({ dummies: [{ name: 'Dummy1', realm: 'TestDummy' }], killSwitchAt: 'x' }),
    ),
  };
  const wowDataReport = {
    gerar: jest.fn<Promise<RelatorioDeDesconhecidos>, [string | undefined]>(() =>
      Promise.resolve({ build: null, bonusIds: [], itemIds: [], itensSemDadoNoBuild: [] }),
    ),
  };
  const wowDataLoader = {
    carregar: jest.fn<Promise<WowDataLoadResult>, [unknown]>(() =>
      Promise.resolve({
        build: '12.1.0.69299',
        novo: true,
        ativo: false,
        linhas: { itens: 963, bonuses: 10085, contextos: 163207, escalas: 1300 },
      }),
    ),
    ativar: jest.fn<Promise<WowDataActivateResult>, [string]>(() =>
      Promise.resolve({ build: '12.1.0.69299', anterior: null }),
    ),
  };

  let controller: OpsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new OpsController(
      snapshots as unknown as SnapshotsService,
      attendance as unknown as AttendanceService,
      blizzard as unknown as BlizzardService,
      catalogGenerator as unknown as LootCatalogGeneratorService,
      catalogService as unknown as LootCatalogService,
      raidProgress as unknown as RaidProgressService,
      rcImport as unknown as RcImportService,
      lootSessions as unknown as LootSessionsService,
      pasteGenerator as unknown as LootCatalogPasteGeneratorService,
      dummies as unknown as LootSessionDummiesService,
      ops as unknown as OpsService,
      wowDataReport as unknown as WowDataReportService,
      wowDataLoader as unknown as WowDataLoaderService,
    );
  });

  it('snapshot sem backfill só chama takeSnapshot', async () => {
    const resultado = await controller.snapshot();
    expect(snapshots.backfillSeasonKeys).not.toHaveBeenCalled();
    expect(snapshots.takeSnapshot).toHaveBeenCalledTimes(1);
    expect(resultado.backfill).toBeUndefined();
  });

  it('snapshot com backfill=true chama os dois', async () => {
    const resultado = await controller.snapshot('true');
    expect(snapshots.backfillSeasonKeys).toHaveBeenCalledTimes(1);
    expect(resultado.backfill).toEqual({ periods: 3, entries: 10 });
    expect(resultado.result).toEqual({ status: 'ok' });
  });

  it('attendance-sync sem argumento usa janela de 30 dias', async () => {
    await controller.attendanceSync();
    const desde = attendance.sync.mock.calls[0]?.[0];
    if (!desde) throw new Error('attendance.sync não foi chamado');
    const esperado = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(desde.getTime() - esperado)).toBeLessThan(5000);
  });

  it('attendance-sync com all=true não passa data — histórico inteiro', async () => {
    await controller.attendanceSync(undefined, 'true');
    expect(attendance.sync).toHaveBeenCalledWith(undefined);
  });

  it('attendance-sync com dias=90 usa a janela pedida', async () => {
    await controller.attendanceSync('90');
    const desde = attendance.sync.mock.calls[0]?.[0];
    if (!desde) throw new Error('attendance.sync não foi chamado');
    const esperado = Date.now() - 90 * 24 * 60 * 60 * 1000;
    expect(Math.abs(desde.getTime() - esperado)).toBeLessThan(5000);
  });

  it('raid-progress sem season passa undefined (season mais recente gravada)', async () => {
    await controller.getRaidProgress();
    expect(raidProgress.getReport).toHaveBeenCalledWith(undefined);
  });

  it('raid-progress com season numérica converte pra number', async () => {
    await controller.getRaidProgress('17');
    expect(raidProgress.getReport).toHaveBeenCalledWith(17);
  });

  it('raid-progress com season inválida (não numérica) ignora e passa undefined', async () => {
    await controller.getRaidProgress('não-é-numero');
    expect(raidProgress.getReport).toHaveBeenCalledWith(undefined);
  });

  it('catalog-item-ids devolve total e a lista do service', async () => {
    const resultado = await controller.catalogItemIds();

    expect(resultado).toEqual({ total: 2, itemIds: [249276, 249277] });
  });

  it('catalog-instances sem filtro devolve as mais recentes por id desc', async () => {
    const resultado = await controller.catalogInstances();
    expect(resultado.total).toBe(2);
    expect(resultado.instancias[0]?.id).toBe(1307);
  });

  it('catalog-instances com filtro busca por nome, case-insensitive', async () => {
    const resultado = await controller.catalogInstances('voidspire');
    expect(resultado.instancias).toHaveLength(1);
    expect(resultado.instancias[0]?.name).toBe('The Voidspire');
  });

  it('catalog-generate chama o gerador com os argumentos certos', async () => {
    await controller.catalogGenerate({ journalInstanceId: 1307, slug: 'the-voidspire' });
    expect(catalogGenerator.gerar).toHaveBeenCalledWith(1307, 'the-voidspire', undefined);
  });

  it('catalog-load repassa semConferencia', async () => {
    const catalog = { slug: 'x' } as unknown as CatalogFile;
    await controller.catalogLoad({ catalog, semConferencia: true });
    expect(catalogService.carregarArquivo).toHaveBeenCalledWith(catalog, {
      semConferencia: true,
    });
  });

  it('catalog-load sem semConferencia default para false', async () => {
    const catalog = { slug: 'x' } as unknown as CatalogFile;
    await controller.catalogLoad({ catalog });
    expect(catalogService.carregarArquivo).toHaveBeenCalledWith(catalog, {
      semConferencia: false,
    });
  });

  it('roster-probe exige guild e realm', async () => {
    await expect(controller.rosterProbe(undefined, undefined, undefined)).rejects.toThrow(
      BadRequestException,
    );
    expect(ops.probeRoster).not.toHaveBeenCalled();
  });

  it('roster-probe repassa personagens separados por vírgula, aparados', async () => {
    await controller.rosterProbe('Titan Inc', 'Azralon', 'Zenithus, Outro');
    expect(ops.probeRoster).toHaveBeenCalledWith('Titan Inc', 'Azralon', ['Zenithus', 'Outro']);
  });

  it('oauth-check sem characters passa array vazio', async () => {
    await controller.oauthCheck();
    expect(ops.checkOauth).toHaveBeenCalledWith([]);
  });

  it('fix-character-ids repassa o resultado do service', async () => {
    ops.fixCharacterIds.mockResolvedValueOnce({
      corrigidos: 2,
      trocas: [{ de: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', para: 'cnovoid00005opg4hxu00tl' }],
    });

    const resultado = await controller.fixCharacterIds();

    expect(ops.fixCharacterIds).toHaveBeenCalledTimes(1);
    expect(resultado.corrigidos).toBe(2);
  });

  it('regerar-historico repassa o id e devolve a contagem', async () => {
    lootSessions.regerarHistorico.mockResolvedValueOnce(3);

    const resultado = await controller.regerarHistoricoDaSessao('sess-1');

    expect(lootSessions.regerarHistorico).toHaveBeenCalledWith('sess-1');
    expect(resultado).toEqual({ linhas: 3 });
  });

  it('gerar-colagem devolve a colagem do gerador', async () => {
    pasteGenerator.gerarColagemAleatoria.mockResolvedValueOnce('TILC/1\tencounter=1');

    const resultado = await controller.gerarColagemDeSessao();

    expect(resultado).toEqual({ paste: 'TILC/1\tencounter=1' });
  });

  it('bonus-unknown-report devolve o relatório do service', async () => {
    wowDataReport.gerar.mockResolvedValueOnce({
      build: '12.1.0.69299',
      bonusIds: [{ bonusId: 9999, ocorrencias: 5 }],
      itemIds: [],
      itensSemDadoNoBuild: [249276],
    });

    const resultado = await controller.bonusUnknownReport();

    expect(wowDataReport.gerar).toHaveBeenCalledWith(undefined);
    expect(resultado.bonusIds).toEqual([{ bonusId: 9999, ocorrencias: 5 }]);
    expect(resultado.itensSemDadoNoBuild).toEqual([249276]);
  });

  it('bonus-unknown-report com ?build= repassa o parâmetro — confere o PTR antes de ativar', async () => {
    await controller.bonusUnknownReport('12.2.0.70000');
    expect(wowDataReport.gerar).toHaveBeenCalledWith('12.2.0.70000');
  });

  it('wow-data-load repassa o arquivo pro loader', async () => {
    const arquivo = { build: '12.1.0.69299' } as unknown as Parameters<
      typeof controller.wowDataLoad
    >[0];

    const resultado = await controller.wowDataLoad(arquivo);

    expect(wowDataLoader.carregar).toHaveBeenCalledWith(arquivo);
    expect(resultado.linhas.contextos).toBe(163207);
  });

  it('wow-data-activate exige ?build=', async () => {
    await expect(controller.wowDataActivate(undefined)).rejects.toThrow(BadRequestException);
    expect(wowDataLoader.ativar).not.toHaveBeenCalled();
  });

  it('wow-data-activate repassa o build pro loader', async () => {
    const resultado = await controller.wowDataActivate('12.1.0.69299');

    expect(wowDataLoader.ativar).toHaveBeenCalledWith('12.1.0.69299');
    expect(resultado.build).toBe('12.1.0.69299');
  });

  describe('rodar-dummies', () => {
    it('sem ?quantidade passa undefined — o default é do service', async () => {
      await controller.rodarDummiesNaSessao('sess-1');
      expect(dummies.rodar).toHaveBeenCalledWith('sess-1', undefined);
    });

    it('com ?quantidade numérica repassa o número', async () => {
      await controller.rodarDummiesNaSessao('sess-1', '4');
      expect(dummies.rodar).toHaveBeenCalledWith('sess-1', 4);
    });

    it('?quantidade não numérica ignora e passa undefined', async () => {
      await controller.rodarDummiesNaSessao('sess-1', 'oito');
      expect(dummies.rodar).toHaveBeenCalledWith('sess-1', undefined);
    });
  });
});
