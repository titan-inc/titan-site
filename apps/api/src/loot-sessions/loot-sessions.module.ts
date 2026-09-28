import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharactersModule } from '../characters/characters.module';
import { LootLinesModule } from '../loot-lines/loot-lines.module';
import { WowItemStatsModule } from '../wow-data/wow-item-stats.module';
import { LootCouncilService } from './loot-council.service';
import { LootSessionChangeBus } from './loot-session-change-bus';
import { LootSessionDummiesService } from './loot-session-dummies.service';
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
 *
 * `LootSessionChangeBus` é o aviso de mudança ao vivo (TIT-68) — sem export:
 * só o repositório (que publica) e o controller (que serve o stream SSE)
 * precisam dele.
 *
 * `LootSessionDummiesService` é a ferramenta de teste do realtime (TIT-68,
 * ver docs/ops.md): exportado porque `OpsModule` é quem expõe a rota.
 *
 * `WowItemStatsModule` entra pelo `calcularVarios` (TIT-135) — o payload de
 * stats de cada item da sessão. Não é `WowDataModule`: aquele importa este
 * módulo de volta (pelo relatório de desconhecidos) e fecharia um ciclo.
 */
@Module({
  imports: [AuthModule, CharactersModule, LootLinesModule, WowItemStatsModule],
  controllers: [LootSessionsController],
  providers: [
    LootSessionsService,
    LootCouncilService,
    LootSessionsRepository,
    LootSessionChangeBus,
    LootSessionDummiesService,
  ],
  exports: [LootSessionsService, LootCouncilService, LootSessionDummiesService],
})
export class LootSessionsModule {}
