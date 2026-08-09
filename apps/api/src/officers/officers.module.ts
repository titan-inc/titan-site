import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlizzardModule } from '../blizzard/blizzard.module';
import { OfficersController } from './officers.controller';
import { OfficersRepository } from './officers.repository';
import { OfficersService } from './officers.service';

/**
 * A lista manual de oficiais.
 *
 * Importa `AuthModule` pelo `OfficerGuard` e `BlizzardModule` para conferir o
 * personagem contra o roster antes de conceder.
 *
 * Não exporta nada, e não é importado pelo `AuthModule`: quem lê a tabela na
 * hora de montar a sessão é o próprio `AuthRepository`. Foi assim que a
 * dependência circular auth ↔ officers deixou de existir — escrever é deste
 * módulo, ler é de quem resolve a sessão.
 */
@Module({
  imports: [AuthModule, BlizzardModule],
  controllers: [OfficersController],
  providers: [OfficersService, OfficersRepository],
})
export class OfficersModule {}
