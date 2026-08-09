import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { WarcraftLogsModule } from '../warcraftlogs/warcraftlogs.module';
import { RaidProgressController } from './raidprogress.controller';
import { RaidProgressPublicController } from './raidprogress.public.controller';
import { RaidProgressService } from './raidprogress.service';

/**
 * Progressão de raid a partir do Warcraft Logs.
 *
 * Importa o SnapshotsModule só pelo `GameSeason` — o seletor de season é o
 * mesmo do relatório de M+, e duplicar a tabela daria duas listas de season que
 * divergem em silêncio.
 */
@Module({
  imports: [AuthModule, SnapshotsModule, WarcraftLogsModule],
  controllers: [RaidProgressController, RaidProgressPublicController],
  providers: [RaidProgressService],
})
export class RaidProgressModule {}
