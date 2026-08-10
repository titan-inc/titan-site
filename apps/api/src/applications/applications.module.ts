import { Module } from '@nestjs/common';
import { DiscordModule } from '../discord/discord.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

/**
 * Entrada stateless de candidaturas. Não importa PrismaModule e não possui
 * repository: o Discord é o único destino da mensagem recebida.
 */
@Module({
  imports: [DiscordModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
})
export class ApplicationsModule {}
