import { Module } from '@nestjs/common';
import { LootCatalogModule } from '../loot-catalog/loot-catalog.module';
import { LootLinesModule } from '../loot-lines/loot-lines.module';
import { LootSessionsModule } from '../loot-sessions/loot-sessions.module';
import { WowBonusReportService } from './wow-bonus-report.service';
import { WowBonusRepository } from './wow-bonus.repository';
import { WowBonusService } from './wow-bonus.service';

/**
 * O dicionário de bonus IDs — TIT-82.
 *
 * Sem controller próprio, de propósito: carregar o dicionário e rodar o
 * relatório de desconhecidos são operações de bastidor, e vivem em
 * `/internal/ops/bonus-*` sob `OpsTokenGuard` — mesmo desenho do
 * `LootCatalogModule` para a escrita do catálogo. A decodificação em si
 * (`WowBonusService.decodificar`) também não tem rota própria ainda: quem a
 * chama é a TIT-135, de dentro de outro módulo — este aqui só entrega o
 * service.
 *
 * `LootLinesModule` e `LootSessionsModule` entram pelo relatório: ele varre
 * `LootLine` e `LootSessionItem`, e cada um só é lido através do service do
 * próprio módulo (Regra 3 — nenhum Prisma cruzando fronteira). `LootCatalogModule`
 * entra pela mesma razão do lado de `WowItem`, e por já ser o precedente de
 * repository exportado entre módulos para um dicionário compartilhado.
 */
@Module({
  imports: [LootLinesModule, LootSessionsModule, LootCatalogModule],
  providers: [WowBonusRepository, WowBonusService, WowBonusReportService],
  exports: [WowBonusService, WowBonusReportService],
})
export class WowBonusModule {}
