import { Module } from '@nestjs/common';
import { LootCatalogModule } from '../loot-catalog/loot-catalog.module';
import { LootLinesModule } from '../loot-lines/loot-lines.module';
import { LootSessionsModule } from '../loot-sessions/loot-sessions.module';
import { WowDataLoaderService } from './wow-data-loader.service';
import { WowDataReportService } from './wow-data-report.service';
import { WowDataService } from './wow-data.service';
import { WowItemStatsModule } from './wow-item-stats.module';

/**
 * O dado do cliente do WoW, versionado por build — TIT-137.
 *
 * Sem controller próprio, de propósito: o relatório de desconhecidos é
 * operação de bastidor e vive em `/internal/ops/*` sob `OpsTokenGuard` —
 * mesmo desenho do `LootCatalogModule` para a escrita do catálogo. A
 * decodificação em si (`WowDataService.decodificar`) também não tem rota
 * própria ainda: quem a chama é a TIT-135, de dentro de outro módulo.
 *
 * A carga (`WowDataLoaderService`, TIT-140) também não tem controller
 * próprio: quem chama é `/internal/ops/wow-data-load` e
 * `/internal/ops/wow-data-activate`, mesmo desenho do `LootCatalogModule`
 * para `catalog-load`. O `POST /internal/ops/bonus-load` que populava a
 * versão antiga foi removido junto com o `kind`: ele carregava um dicionário
 * curado à mão, e o modelo que ele preenchia deixou de existir.
 *
 * `WowDataRepository` e `WowItemStatsService` (TIT-136) moram em
 * `WowItemStatsModule`, não aqui — TIT-135. A razão é o sentido do import:
 * este módulo já importa `LootSessionsModule`/`LootLinesModule` para o
 * relatório, e se `loot-sessions`/`loot-lines` importassem `WowDataModule`
 * de volta para consumir `calcularVarios`, fecharia um ciclo. Separado, o
 * cálculo de stats não depende de nenhum dos dois domínios, e cada um
 * importa só `WowItemStatsModule`.
 *
 * `LootLinesModule` e `LootSessionsModule` entram pelo relatório: ele varre
 * `LootLine` e `LootSessionItem`, e cada um só é lido através do service do
 * próprio módulo (Regra 3 — nenhum Prisma cruzando fronteira). `LootCatalogModule`
 * entra pela mesma razão do lado de `WowItem`, e por já ser o precedente de
 * repository exportado entre módulos para um dicionário compartilhado.
 */
@Module({
  imports: [LootLinesModule, LootSessionsModule, LootCatalogModule, WowItemStatsModule],
  providers: [WowDataService, WowDataReportService, WowDataLoaderService],
  exports: [WowDataService, WowDataReportService, WowDataLoaderService, WowItemStatsModule],
})
export class WowDataModule {}
