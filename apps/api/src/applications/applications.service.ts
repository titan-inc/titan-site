import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ApplyResult, CreateApplication } from '@titan/shared';
import { DiscordDeliveryError, DiscordService } from '../discord/discord.service';
import { buildApplicationEmbed } from './embed';

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  // Este serviço não tem repository nem Prisma por decisão arquitetural: o
  // Discord é o destino e nenhuma candidatura é persistida.
  constructor(private readonly discord: DiscordService) {}

  async apply(application: CreateApplication): Promise<ApplyResult> {
    if (application.website?.trim()) {
      this.logger.debug('Candidatura descartada pelo honeypot.');
      return { delivered: true };
    }

    try {
      await this.discord.send('apply', buildApplicationEmbed(application));
      this.logger.log('Candidatura entregue ao Discord.');
      return { delivered: true };
    } catch (error: unknown) {
      if (!(error instanceof DiscordDeliveryError)) throw error;

      if (error.kind === 'unconfigured' || error.kind === 'configuration') {
        throw new ServiceUnavailableException('Envio indisponível no momento.');
      }

      if (error.kind === 'rate-limit') {
        throw new ServiceUnavailableException('Envio indisponível no momento.');
      }

      if (error.kind === 'upstream') {
        throw new BadGatewayException('Não foi possível entregar sua candidatura agora.');
      }

      throw new InternalServerErrorException();
    }
  }
}
