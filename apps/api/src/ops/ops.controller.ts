import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  catalogFileSchema,
  parseJournalDump,
  rcExportSchema,
  type CatalogFile,
  type RaidProgressReport,
  type RcExport,
} from '@titan/shared';
import { z } from 'zod';
import { AttendanceService, type SyncResult } from '../attendance/attendance.service';
import { BlizzardService } from '../blizzard/blizzard.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LootCatalogGeneratorService } from '../loot-catalog/loot-catalog-generator.service';
import { LootCatalogPasteGeneratorService } from '../loot-catalog/loot-catalog-paste-generator.service';
import { LootCatalogService } from '../loot-catalog/loot-catalog.service';
import { RcImportService, type RcImportResult } from '../loot-lines/rc-import.service';
import {
  LootSessionDummiesService,
  type ResultadoRodarDummies,
} from '../loot-sessions/loot-session-dummies.service';
import { LootSessionsService } from '../loot-sessions/loot-sessions.service';
import { RaidProgressService } from '../raidprogress/raidprogress.service';
import { SnapshotsService, type SnapshotResult } from '../snapshots/snapshots.service';
import {
  WowDataReportService,
  type RelatorioDeDesconhecidos,
} from '../wow-data/wow-data-report.service';
import { OpsTokenGuard } from './ops-token.guard';
import {
  OpsService,
  type FixCharacterIdsResult,
  type OauthCheckResult,
  type RosterProbeResult,
} from './ops.service';

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
 * `undefined` quando ausente ou não numérico — o clamp e o default vivem no
 * `LootSessionDummiesService`, não aqui. Parâmetro de conveniência de
 * ferramenta de dev, então cai no default em vez de recusar (diferente do
 * `GUILD_OFFICER_RANK_MAX`, que é config de boot).
 */
function parseQuantidade(raw?: string): number | undefined {
  return raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
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
    private readonly rcImport: RcImportService,
    private readonly lootSessions: LootSessionsService,
    private readonly pasteGenerator: LootCatalogPasteGeneratorService,
    private readonly dummies: LootSessionDummiesService,
    private readonly ops: OpsService,
    private readonly wowDataReport: WowDataReportService,
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

  /**
   * Todo `itemId` cadastrado no catálogo — TIT-82/TIT-136. Sem script
   * antigo equivalente.
   *
   * Serve para filtrar db2 gigantes (`ItemSparse.db2`, ~59MB) pelos itens que
   * interessam antes de carregar, no mesmo espírito do que a colagem do
   * `/tilc journal` já resolve para o catálogo. Mesmo formato de resposta do
   * `catalog-instances`.
   */
  @Get('catalog-item-ids')
  async catalogItemIds(): Promise<{ total: number; itemIds: number[] }> {
    const itemIds = await this.catalogService.listarItemIdsCatalogados();
    return { total: itemIds.length, itemIds };
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

  /**
   * Importa o export do RCLootCouncil — TIT-53.
   *
   * O arquivo vai no corpo, igual ao `catalog-load`, porque o container não tem
   * o arquivo e é efêmero. São ~304 KB, acima do teto público de 16kb: quem
   * libera é o `json({ limit: '20mb' })` do prefixo de ops no `main.ts`.
   *
   * Idempotente. Rodar de novo atualiza as mesmas linhas e devolve os mesmos
   * números.
   */
  @Post('loot-import-rc')
  async lootImportRc(
    @Body(new ZodValidationPipe(rcExportSchema)) arquivo: RcExport,
  ): Promise<RcImportResult> {
    return this.rcImport.importar(arquivo);
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

  /**
   * "O que ainda não conhecemos" — TIT-82, agora respondendo pelo build ativo
   * (TIT-137). Sem corpo, sem parâmetro: varre o histórico e as sessões já
   * gravados, ordenado por frequência.
   *
   * SEM BUILD ATIVO responde "tudo desconhecido", que é a verdade — e é
   * exatamente o que se quer ver antes da primeira carga.
   *
   * A carga que populava a tabela (`POST bonus-load`) FOI REMOVIDA junto com o
   * `kind`: ela subia um dicionário curado à mão, e o modelo que ela preenchia
   * deixou de existir. Quem repõe é a TIT-139 (gerador) mais a TIT-140
   * (carga e ativação).
   */
  @Get('bonus-unknown-report')
  async bonusUnknownReport(): Promise<RelatorioDeDesconhecidos> {
    return this.wowDataReport.gerar();
  }

  /**
   * Corrige os ids de identidade que o backfill da TIT-132 (16/08) criou em
   * uuid — `cuid()` é `@default` avaliado em JS, não existe em SQL puro.
   *
   * Idempotente: rodar de novo não acha mais nenhum id fora do padrão e
   * devolve `corrigidos: 0`. Sem corpo — nada a validar, a operação não
   * recebe parâmetro nenhum.
   */
  @Post('fix-character-ids')
  async fixCharacterIds(): Promise<FixCharacterIdsResult> {
    return this.ops.fixCharacterIds();
  }

  /**
   * Regera as linhas de histórico de uma sessão de loot council já encerrada
   * — TIT-69, Regra 8.
   *
   * Rede de segurança: o encerramento já grava status e histórico na mesma
   * transação, mas isto cobre o caso de uma sessão ter ficado encerrada sem
   * linha nenhuma (dado de antes desta atomicidade, ou intervenção manual no
   * banco). Idempotente — a chave é `LootSessionItem.id`, então rodar de novo
   * atualiza as mesmas linhas em vez de duplicar.
   *
   * Sem corpo: o único parâmetro é o id da sessão, no caminho.
   */
  @Post('loot-sessions/:id/regerar-historico')
  async regerarHistoricoDaSessao(@Param('id') id: string): Promise<{ linhas: number }> {
    return { linhas: await this.lootSessions.regerarHistorico(id) };
  }

  /**
   * Ferramenta de teste do realtime — TIT-68. Sorteia um boss REAL do
   * catálogo (com ao menos 3 drops cadastrados numa dificuldade) e devolve a
   * colagem pronta para colar em "Iniciar sessão" — não cria a sessão
   * sozinha, só poupa montar uma colagem válida à mão.
   */
  @Get('loot-sessions/gerar-colagem')
  async gerarColagemDeSessao(): Promise<{ paste: string }> {
    return { paste: await this.pasteGenerator.gerarColagemAleatoria() };
  }

  /**
   * Ferramenta de teste do realtime — TIT-68. Sobe N jogadores 100%
   * sintéticos (`Dummy1..DummyN`, nunca personagem real) que entram na
   * sessão e, a cada ~2s, respondem/comentam/editam em `aberta`, ou reagem a
   * um `reabrirResposta` do loot master em `deliberando`. Para sozinha
   * quando a sessão encerra, ou depois de 10min (kill switch).
   *
   * Fire-and-forget: devolve na hora, o loop roda em segundo plano.
   * `?quantidade=` é opcional (padrão 6, clamp 2–10).
   */
  @Post('loot-sessions/:id/rodar-dummies')
  async rodarDummiesNaSessao(
    @Param('id') id: string,
    @Query('quantidade') quantidade?: string,
  ): Promise<ResultadoRodarDummies> {
    return this.dummies.rodar(id, parseQuantidade(quantidade));
  }
}
