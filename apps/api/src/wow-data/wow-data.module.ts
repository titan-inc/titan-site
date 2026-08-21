import { Module } from '@nestjs/common';
import { LootCatalogModule } from '../loot-catalog/loot-catalog.module';
import { LootLinesModule } from '../loot-lines/loot-lines.module';
import { LootSessionsModule } from '../loot-sessions/loot-sessions.module';
import { WowDataReportService } from './wow-data-report.service';
import { WowDataRepository } from './wow-data.repository';
import { WowDataService } from './wow-data.service';

/**
 * O dado do cliente do WoW, versionado por build — TIT-137.
 *
 * Sem controller próprio, de propósito: o relatório de desconhecidos é
 * operação de bastidor e vive em `/internal/ops/*` sob `OpsTokenGuard` —
 * mesmo desenho do `LootCatalogModule` para a escrita do catálogo. A
 * decodificação em si (`WowDataService.decodificar`) também não tem rota
 * própria ainda: quem a chama é a TIT-135, de dentro de outro módulo.
 *
 * **A CARGA NÃO MORA AQUI, e é de propósito.** Carregar e ativar um build são
 * a TIT-140; enquanto ela não existir, estas tabelas não têm como ser
 * populadas — o que é invisível para a guilda, porque nada que ela vê lê
 * daqui ainda. O `POST /internal/ops/bonus-load` que populava a versão antiga
 * foi removido junto com o `kind`: ele carregava um dicionário curado à mão,
 * e o modelo que ele preenchia deixou de existir.
 *
 * `LootLinesModule` e `LootSessionsModule` entram pelo relatório: ele varre
 * `LootLine` e `LootSessionItem`, e cada um só é lido através do service do
 * próprio módulo (Regra 3 — nenhum Prisma cruzando fronteira). `LootCatalogModule`
 * entra pela mesma razão do lado de `WowItem`, e por já ser o precedente de
 * repository exportado entre módulos para um dicionário compartilhado.
 */
@Module({
  imports: [LootLinesModule, LootSessionsModule, LootCatalogModule],
  providers: [WowDataRepository, WowDataService, WowDataReportService],
  exports: [WowDataService, WowDataReportService],
})
export class WowDataModule {}
