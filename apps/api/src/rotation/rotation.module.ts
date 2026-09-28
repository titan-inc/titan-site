import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharactersModule } from '../characters/characters.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WowAuditModule } from '../wowaudit/wowaudit.module';
import { RotationController } from './rotation.controller';
import { RotationRepository } from './rotation.repository';
import { RotationService } from './rotation.service';

@Module({
  // AuthModule porque o OfficerGuard depende do AuthService — sem ele o
  // módulo nem sobe, e a mensagem do Nest não diz que falta este import.
  imports: [AuthModule, PrismaModule, WowAuditModule, CharactersModule],
  controllers: [RotationController],
  providers: [RotationService, RotationRepository],
})
export class RotationModule {}
