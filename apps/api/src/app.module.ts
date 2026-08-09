import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BlizzardModule } from './blizzard/blizzard.module';
import { HealthModule } from './health/health.module';
import { InternalModule } from './internal/internal.module';
import { MembershipModule } from './membership/membership.module';
import { PrismaModule } from './prisma/prisma.module';
import { RaidProgressModule } from './raidprogress/raidprogress.module';
import { RosterModule } from './roster/roster.module';
import { SnapshotsModule } from './snapshots/snapshots.module';

@Module({
  imports: [
    // Sem forRoot() os @Cron não são registrados e o job simplesmente nunca roda,
    // sem erro nenhum.
    ScheduleModule.forRoot(),
    PrismaModule,
    BlizzardModule,
    AuthModule,
    InternalModule,
    RosterModule,
    SnapshotsModule,
    RaidProgressModule,
    MembershipModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
