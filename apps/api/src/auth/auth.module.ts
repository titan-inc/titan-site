import { Module } from '@nestjs/common';
import { BlizzardModule } from '../blizzard/blizzard.module';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { MemberGuard, RosterGuard } from './session.guard';

@Module({
  imports: [BlizzardModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, MemberGuard, RosterGuard],
  exports: [AuthService, MemberGuard, RosterGuard],
})
export class AuthModule {}
