import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ApplicationsModule } from './applications/applications.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AuthModule } from './auth/auth.module';
import { BlizzardModule } from './blizzard/blizzard.module';
import { GuildRosterModule } from './guild-roster/guild-roster.module';
import { LootCatalogModule } from './loot-catalog/loot-catalog.module';
import { LootLinesModule } from './loot-lines/loot-lines.module';
import { LootSessionsModule } from './loot-sessions/loot-sessions.module';
import { HealthModule } from './health/health.module';
import { InternalModule } from './internal/internal.module';
import { MembershipModule } from './membership/membership.module';
import { MplusModule } from './mplus/mplus.module';
import { OfficersModule } from './officers/officers.module';
import { OpsModule } from './ops/ops.module';
import { PrismaModule } from './prisma/prisma.module';
import { RaidProgressModule } from './raidprogress/raidprogress.module';
import { RosterModule } from './roster/roster.module';
import { SnapshotsModule } from './snapshots/snapshots.module';

@Module({
  imports: [
    // Sem forRoot() os @Cron não são registrados e o job simplesmente nunca roda,
    // sem erro nenhum.
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60 * 60 * 1_000, limit: 5 }]),
    PrismaModule,
    BlizzardModule,
    AuthModule,
    InternalModule,
    RosterModule,
    GuildRosterModule,
    SnapshotsModule,
    RaidProgressModule,
    AttendanceModule,
    MembershipModule,
    OfficersModule,
    LootCatalogModule,
    // Explícito, e não só via OpsModule: o módulo tem controller próprio agora,
    // e depender de ele entrar no grafo de carona faria a rota sumir no dia em
    // que alguém removesse o import lá.
    LootLinesModule,
    LootSessionsModule,
    HealthModule,
    ApplicationsModule,
    MplusModule,
    OpsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
