import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DiscordModule } from '../discord/discord.module';
import { MplusController } from './mplus.controller';
import { MplusRepository } from './mplus.repository';
import { MplusService } from './mplus.service';

/**
 * Anúncio de vaga de M+ no Discord.
 *
 * Importa `AuthModule` pelo `RosterGuard` e `DiscordModule` para entregar. Tem
 * repository, ao contrário do módulo de candidaturas: aqui a linha existe, e
 * existir é o que permite apagar à mão, linkar a página da vaga e saber que uma
 * mensagem não chegou.
 */
@Module({
  imports: [AuthModule, DiscordModule],
  controllers: [MplusController],
  providers: [MplusService, MplusRepository],
})
export class MplusModule {}
