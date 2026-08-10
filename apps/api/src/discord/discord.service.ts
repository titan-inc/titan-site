import { Injectable, Logger } from '@nestjs/common';
import { loadDiscordConfig } from '../config/discord.config';

export interface DiscordWebhookPayload {
  username?: string;
  embeds: Array<{
    title: string;
    color: number;
    description?: string;
    fields: Array<{ name: string; value: string; inline: boolean }>;
    timestamp: string;
  }>;
  allowed_mentions: { parse: [] };
}

export type DiscordFailureKind =
  'unconfigured' | 'configuration' | 'payload' | 'rate-limit' | 'upstream';

export class DiscordDeliveryError extends Error {
  constructor(
    readonly kind: DiscordFailureKind,
    readonly status?: number,
    readonly retryAfter?: number,
  ) {
    super(`Falha de entrega ao Discord (${kind}${status ? `, HTTP ${status}` : ''})`);
    this.name = 'DiscordDeliveryError';
  }
}

@Injectable()
export class DiscordService {
  private readonly logger = new Logger(DiscordService.name);
  private readonly webhookUrl = loadDiscordConfig().webhookUrl;

  constructor() {
    if (!this.webhookUrl) {
      this.logger.error(
        'Candidaturas indisponíveis: DISCORD_APPLY_WEBHOOK_URL não está configurada.',
      );
    }
  }

  async send(payload: DiscordWebhookPayload): Promise<void> {
    if (!this.webhookUrl) throw new DiscordDeliveryError('unconfigured');

    let response: Response;
    try {
      response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Não inclua o erro original: mensagens de fetch podem carregar a URL
      // completa, que contém o segredo do webhook.
      throw new DiscordDeliveryError('upstream');
    }

    if (response.ok) {
      if (response.status !== 204) {
        this.logger.warn(`Discord aceitou a candidatura com HTTP ${response.status}, não 204.`);
      }
      return;
    }

    if (response.status === 429) {
      const retryAfter = await this.readRetryAfter(response);
      this.logger.warn(
        `Discord limitou a entrega (HTTP 429${retryAfter === undefined ? '' : `, retry_after=${retryAfter}`}).`,
      );
      throw new DiscordDeliveryError('rate-limit', response.status, retryAfter);
    }

    if ([401, 403, 404].includes(response.status)) {
      this.logger.error(`Webhook do Discord inválido ou revogado (HTTP ${response.status}).`);
      throw new DiscordDeliveryError('configuration', response.status);
    }

    if (response.status >= 400 && response.status < 500) {
      this.logger.error(`Discord recusou o payload da candidatura (HTTP ${response.status}).`);
      throw new DiscordDeliveryError('payload', response.status);
    }

    this.logger.warn(`Discord indisponível ao entregar candidatura (HTTP ${response.status}).`);
    throw new DiscordDeliveryError('upstream', response.status);
  }

  private async readRetryAfter(response: Response): Promise<number | undefined> {
    try {
      const body = (await response.json()) as { retry_after?: unknown };
      return typeof body.retry_after === 'number' ? body.retry_after : undefined;
    } catch {
      return undefined;
    }
  }
}
