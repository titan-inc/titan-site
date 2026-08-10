import { BadRequestException } from '@nestjs/common';
import type { CatalogFile } from '@titan/shared';
import type { AttendanceService } from '../attendance/attendance.service';
import type { BlizzardService } from '../blizzard/blizzard.service';
import type { LootCatalogGeneratorService } from '../loot-catalog/loot-catalog-generator.service';
import type { LootCatalogService } from '../loot-catalog/loot-catalog.service';
import type { SnapshotsService } from '../snapshots/snapshots.service';
import { OpsController } from './ops.controller';
import type { OpsService } from './ops.service';

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
  };
  const ops = {
    probeRoster: jest.fn(() => Promise.resolve({ guild: 'Titan Inc' })),
    checkOauth: jest.fn(() => Promise.resolve({ ok: true, stale: false })),
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
      ops as unknown as OpsService,
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
});
