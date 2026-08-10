import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  catalogFileSchema,
  parseJournalDump,
  type CatalogFile,
  type RaidProgressReport,
} from '@titan/shared';
import { z } from 'zod';
import { AttendanceService, type SyncResult } from '../attendance/attendance.service';
import { BlizzardService } from '../blizzard/blizzard.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LootCatalogGeneratorService } from '../loot-catalog/loot-catalog-generator.service';
import { LootCatalogService } from '../loot-catalog/loot-catalog.service';
import { RaidProgressService } from '../raidprogress/raidprogress.service';
import { SnapshotsService, type SnapshotResult } from '../snapshots/snapshots.service';
import { OpsTokenGuard } from './ops-token.guard';
import { OpsService, type OauthCheckResult, type RosterProbeResult } from './ops.service';

const catalogGenerateBodySchema = z.object({
  journalInstanceId: z.number().int().positive(),
  slug: z.string().optional(),
  /** Colagem crua do `/tilc journal` do addon — mesmo formato que
   * `--journal <arquivo>` aceitava no script antigo, só que como texto no
   * corpo em vez de caminho de arquivo (o container não tem o arquivo). */
  journalDump: z.string().optional(),
});

const catalogLoadBodySchema = z.object({
  catalog: catalogFileSchema,
  semConferencia: z.boolean().optional(),
});

function parseCharacters(raw?: string): string[] {
  return raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

/** Mesma semântica da função `janela()` que existia em attendance-probe.js. */
function parseJanela(dias?: string, all?: string): Date | undefined {
  if (all === 'true') return undefined;
  const n = dias && /^\d+$/.test(dias) ? Number(dias) : 30;
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

/**
 * Operações administrativas contra a app JÁ RODANDO — nunca sobe instância
 * própria.
 *
 * Ver TIT-109: `apps/api/scripts/*-probe.js` chamava
 * `NestFactory.createApplicationContext` num processo à parte, dentro do
 * mesmo container que já roda essa árvore inteira como processo principal.
 * Numa instância de 1GB isso dobrou o consumo de memória da api e derrubou
 * a instância inteira uma vez. Estas rotas fazem a mesma coisa que os
 * scripts faziam, chamando os MESMOS services — só que dentro do processo
 * que já está de pé, sem custo de memória extra.
 *
 * Bloqueada no domínio público pelo Caddyfile — só alcançável de dentro do
 * container (`docker compose exec`) ou por túnel SSH, mesmo padrão do
 * Postgres. `OpsTokenGuard` é a segunda camada.
 */
@Controller('internal/ops')
@UseGuards(OpsTokenGuard)
export class OpsController {
  constructor(
    private readonly snapshots: SnapshotsService,
    private readonly attendance: AttendanceService,
    private readonly blizzard: BlizzardService,
    private readonly catalogGenerator: LootCatalogGeneratorService,
    private readonly catalogService: LootCatalogService,
    private readonly raidProgress: RaidProgressService,
    private readonly ops: OpsService,
  ) {}

  /** Era `pnpm --filter api probe:snapshot [--backfill]`. */
  @Post('snapshot')
  async snapshot(
    @Query('backfill') backfill?: string,
  ): Promise<{ backfill?: { periods: number; entries: number }; result: SnapshotResult }> {
    const saida: { backfill?: { periods: number; entries: number }; result: SnapshotResult } = {
      result: undefined as unknown as SnapshotResult,
    };
    if (backfill === 'true') {
      saida.backfill = await this.snapshots.backfillSeasonKeys();
    }
    saida.result = await this.snapshots.takeSnapshot();
    return saida;
  }

  /** Era `pnpm --filter api probe:attendance [--all|--dias N]`. */
  @Post('attendance-sync')
  async attendanceSync(
    @Query('dias') dias?: string,
    @Query('all') all?: string,
  ): Promise<SyncResult> {
    return this.attendance.sync(parseJanela(dias, all));
  }

  /**
   * Era `pnpm --filter api probe:raid [season]`.
   *
   * Mesma chamada que `GET /internal/raid-progress` já faz — existe aqui
   * só pra não exigir cookie de sessão de membro num `curl`/CLI. Read-only,
   * sem risco extra de expor nada que a área interna já não mostre.
   */
  @Get('raid-progress')
  async getRaidProgress(@Query('season') season?: string): Promise<RaidProgressReport | null> {
    const id = season && /^\d+$/.test(season) ? Number(season) : undefined;
    return this.raidProgress.getReport(id);
  }

  /** Era `pnpm --filter api catalog:generate --lista [filtro]`. */
  @Get('catalog-instances')
  async catalogInstances(
    @Query('filtro') filtro?: string,
  ): Promise<{ total: number; instancias: Array<{ id: number; name: string }> }> {
    const instancias = await this.blizzard.getJournalInstanceIndex();
    const alvo = filtro
      ? instancias.filter((i) => i.name.toLowerCase().includes(filtro.toLowerCase()))
      : instancias
          .slice()
          .sort((a, b) => b.id - a.id)
          .slice(0, 25);
    return { total: instancias.length, instancias: alvo };
  }

  /**
   * Era `pnpm --filter api catalog:generate <id> --saida <arquivo>`.
   *
   * NÃO escreve arquivo — o container é efêmero, gravar ali não persiste
   * nada em lugar nenhum. Devolve o JSON gerado no corpo da resposta; quem
   * chamar salva local (`curl ... -o catalogo/x.json`) e segue o mesmo
   * fluxo de revisão + commit de antes.
   */
  @Post('catalog-generate')
  async catalogGenerate(
    @Body(new ZodValidationPipe(catalogGenerateBodySchema))
    body: z.infer<typeof catalogGenerateBodySchema>,
  ): Promise<CatalogFile> {
    const dump = body.journalDump ? parseJournalDump(body.journalDump) : undefined;
    return this.catalogGenerator.gerar(body.journalInstanceId, body.slug, dump);
  }

  /** Era `pnpm --filter api catalog:load <arquivo.json> [--sem-conferencia]`. */
  @Post('catalog-load')
  async catalogLoad(
    @Body(new ZodValidationPipe(catalogLoadBodySchema))
    body: z.infer<typeof catalogLoadBodySchema>,
  ) {
    return this.catalogService.carregarArquivo(body.catalog, {
      semConferencia: body.semConferencia ?? false,
    });
  }

  /** Era `node scripts/roster-probe.js "<Guilda>" <realm> [personagem...]`. */
  @Get('roster-probe')
  async rosterProbe(
    @Query('guild') guild?: string,
    @Query('realm') realm?: string,
    @Query('characters') characters?: string,
  ): Promise<RosterProbeResult> {
    if (!guild || !realm) {
      throw new BadRequestException('guild e realm são obrigatórios');
    }
    return this.ops.probeRoster(guild, realm, parseCharacters(characters));
  }

  /** Era `pnpm --filter api probe:oauth [personagem...]`. */
  @Get('oauth-check')
  async oauthCheck(@Query('characters') characters?: string): Promise<OauthCheckResult> {
    return this.ops.checkOauth(parseCharacters(characters));
  }
}
