import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharactersModule } from '../characters/characters.module';
import { LootLinesModule } from '../loot-lines/loot-lines.module';
import { LootCouncilService } from './loot-council.service';
import { LootSessionsController } from './loot-sessions.controller';
import { LootSessionsRepository } from './loot-sessions.repository';
import { LootSessionsService } from './loot-sessions.service';

/**
 * A sessão de loot council ao vivo.
 *
 * Separado do `loot-lines`, que é o histórico, embora a sessão vire linha de
 * loot no encerramento (TIT-69) — daí `LootLinesModule` nos `imports`. São
 * domínios diferentes: um é decisão acontecendo, o outro é registro do que já
 * foi decidido, e a dependência só anda nesta direção — `loot-lines` continua
 * funcionando sem `loot-sessions`, que é o que a importação prova.
 *
 * `AuthModule` entra pelos guards: leitura por membro, escrita por oficial.
 */
@Module({
  imports: [AuthModule, CharactersModule, LootLinesModule],
  controllers: [LootSessionsController],
  providers: [LootSessionsService, LootCouncilService, LootSessionsRepository],
  exports: [LootSessionsService, LootCouncilService],
})
export class LootSessionsModule {}
