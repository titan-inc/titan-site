import { Module } from '@nestjs/common';
import { WowDataRepository } from './wow-data.repository';
import { WowItemStatsService } from './wow-item-stats.service';

/**
 * O cálculo de stats de item (TIT-136), sozinho — separado de
 * `WowDataModule` de propósito, TIT-135.
 *
 * `WowDataModule` importa `LootSessionsModule`/`LootLinesModule` para o
 * relatório de desconhecidos. Se `LootSessionsModule`/`LootLinesModule`
 * importassem `WowDataModule` de volta para consumir `calcularVarios`,
 * fecharia um ciclo (`WowDataModule → LootSessionsModule → WowDataModule`).
 *
 * `WowItemStatsService` não depende de nada de `loot-sessions`/`loot-lines`
 * — só de `WowDataRepository`, que também mora aqui —, então este módulo
 * não importa nenhum dos dois, e o ciclo nunca se fecha. `WowDataModule`
 * importa `WowItemStatsModule` (não o contrário) para seguir provendo
 * `WowDataService`/`WowDataReportService`/o loader, que também usam
 * `WowDataRepository`.
 */
@Module({
  providers: [WowDataRepository, WowItemStatsService],
  exports: [WowDataRepository, WowItemStatsService],
})
export class WowItemStatsModule {}
