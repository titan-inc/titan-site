import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LootSessionsController } from './loot-sessions.controller';
import { LootSessionsRepository } from './loot-sessions.repository';
import { LootSessionsService } from './loot-sessions.service';

/**
 * A sessão de loot council ao vivo.
 *
 * Separado do `loot-lines`, que é o histórico, embora a sessão vá virar linha de
 * loot no encerramento (TIT-69). São domínios diferentes: um é decisão
 * acontecendo, o outro é registro do que já foi decidido — e o segundo tem que
 * continuar funcionando sem o primeiro, que é o que a importação prova.
 *
 * `AuthModule` entra pelos guards: leitura por membro, escrita por oficial.
 */
@Module({
  imports: [AuthModule],
  controllers: [LootSessionsController],
  providers: [LootSessionsService, LootSessionsRepository],
  exports: [LootSessionsService],
})
export class LootSessionsModule {}
