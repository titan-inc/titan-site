import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { BlizzardModule } from '../blizzard/blizzard.module';
import { CharactersModule } from '../characters/characters.module';
import { LootCatalogModule } from '../loot-catalog/loot-catalog.module';
import { LootLinesModule } from '../loot-lines/loot-lines.module';
import { LootSessionsModule } from '../loot-sessions/loot-sessions.module';
import { RaidProgressModule } from '../raidprogress/raidprogress.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { WowBonusModule } from '../wow-bonus/wow-bonus.module';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

/**
 * Operações administrativas (ex-`apps/api/scripts/*-probe.js`) contra a app
 * já rodando — ver TIT-109. Só reaproveita services que já existem nos
 * módulos importados; nenhuma lógica de negócio nova, exceto o que virou
 * `OpsService` (roster-probe e oauth-check nunca tiveram service próprio).
 *
 * `LootSessionsModule` entra pela rota que regera o histórico de uma sessão
 * encerrada (TIT-69) — rede de segurança para `encerrarComHistorico`.
 */
@Module({
  imports: [
    SnapshotsModule,
    AttendanceModule,
    BlizzardModule,
    CharactersModule,
    LootCatalogModule,
    LootLinesModule,
    LootSessionsModule,
    RaidProgressModule,
    WowBonusModule,
  ],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
