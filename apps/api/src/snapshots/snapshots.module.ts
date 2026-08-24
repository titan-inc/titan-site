import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlizzardModule } from '../blizzard/blizzard.module';
import { CharactersModule } from '../characters/characters.module';
import { GameVersionModule } from '../gameversion/gameversion.module';
import { RaiderIoModule } from '../raiderio/raiderio.module';
import { WowAuditModule } from '../wowaudit/wowaudit.module';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { SnapshotsRepository } from './snapshots.repository';
import { SnapshotsService } from './snapshots.service';

/**
 * Gravação (cron) e leitura (relatório) do mesmo domínio, no mesmo módulo —
 * assim o Prisma continua confinado a um repository só, como manda a Regra 3.
 */
@Module({
  imports: [
    AuthModule,
    BlizzardModule,
    CharactersModule,
    WowAuditModule,
    RaiderIoModule,
    GameVersionModule,
  ],
  controllers: [ProgressController],
  providers: [SnapshotsService, SnapshotsRepository, ProgressService],
  // O repository sai do módulo porque `GameSeason` é daqui e o seletor de
  // season é o mesmo em toda a área interna — ver raidprogress. Prisma continua
  // confinado a um repository só, que é o que a Regra 3 pede.
  exports: [SnapshotsService, SnapshotsRepository],
})
export class SnapshotsModule {}
