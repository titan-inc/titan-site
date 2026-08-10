import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { BlizzardModule } from '../blizzard/blizzard.module';
import { LootCatalogModule } from '../loot-catalog/loot-catalog.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

/**
 * Operações administrativas (ex-`apps/api/scripts/*-probe.js`) contra a app
 * já rodando — ver TIT-109. Só reaproveita services que já existem nos
 * módulos importados; nenhuma lógica de negócio nova, exceto o que virou
 * `OpsService` (roster-probe e oauth-check nunca tiveram service próprio).
 */
@Module({
  imports: [SnapshotsModule, AttendanceModule, BlizzardModule, LootCatalogModule],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
