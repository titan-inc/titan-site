import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlizzardModule } from '../blizzard/blizzard.module';
import { GuildRosterController } from './guild-roster.controller';
import { GuildRosterRepository } from './guild-roster.repository';
import { GuildRosterService } from './guild-roster.service';

/**
 * `AuthModule` pelo `OfficerGuard`, `BlizzardModule` pelo roster da guilda.
 * `PrismaModule` não precisa de import: é `@Global()`.
 */
@Module({
  imports: [AuthModule, BlizzardModule],
  controllers: [GuildRosterController],
  providers: [GuildRosterService, GuildRosterRepository],
})
export class GuildRosterModule {}
