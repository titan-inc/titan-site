import { Injectable, Logger } from '@nestjs/common';
import {
  DISCORD_DESTINOS,
  DISCORD_ENV_POR_DESTINO,
  loadDiscordConfig,
  type DiscordDestino,
} from '../config/discord.config';

export interface DiscordWebhookPayload {
  username?: string;
  /** Texto fora do embed. Usado só para a menção de cargo do canal de M+. */
  content?: string;
  embeds: Array<{
    title: string;
    /** Torna o título clicável. Usado para linkar a página exata (Regra 7). */
    url?: string;
    color: number;
    description?: string;
    fields: Array<{ name: string; value: string; inline: boolean }>;
    timestamp: string;
  }>;
  /**
   * `parse: []` é obrigatório em toda mensagem: sem ele, um `@everyone`
   * digitado por qualquer pessoa dispara de verdade, pelo webhook da guilda.
   *
   * `roles` é a única exceção pensável, e é whitelist de id fixo em
   * configuração — nunca um id que veio de texto digitado.
   */
  allowed_mentions: { parse: []; roles?: string[] };
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

/**
 * Único lugar do código que conhece o formato de fio do Discord.
 *
 * Fala com **N canais**, um por destino, e a escolha é sempre do chamador via
 * `send(destino, …)`. Nenhum estado guarda "o webhook atual": dois destinos
 * nunca se confundem porque nunca compartilham variável.
 */
@Injectable()
export class DiscordService {
  private readonly logger = new Logger(DiscordService.name);
  private readonly config = loadDiscordConfig();

  constructor() {
    for (const destino of DISCORD_DESTINOS) {
      if (!this.config.webhooks[destino]) {
        // Erro, não warn: alguém precisa arrumar. Mesmo assim não derruba o
        // boot — falta de um destino só desabilita aquele destino.
        this.logger.error(
          `Entrega "${destino}" indisponível: ${DISCORD_ENV_POR_DESTINO[destino]} não está configurada.`,
        );
      }
    }
  }

  /** Id do cargo a mencionar no canal de M+, quando configurado. */
  get mplusRoleId(): string | undefined {
    return this.config.mplusRoleId;
  }

  async send(destino: DiscordDestino, payload: DiscordWebhookPayload): Promise<void> {
    const webhookUrl = this.config.webhooks[destino];
    if (!webhookUrl) throw new DiscordDeliveryError('unconfigured');

    let response: Response;
    try {
      response = await fetch(webhookUrl, {
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
        this.logger.warn(`Discord aceitou "${destino}" com HTTP ${response.status}, não 204.`);
      }
      return;
    }

    if (response.status === 429) {
      const retryAfter = await this.readRetryAfter(response);
      this.logger.warn(
        `Discord limitou a entrega de "${destino}" (HTTP 429${retryAfter === undefined ? '' : `, retry_after=${retryAfter}`}).`,
      );
      throw new DiscordDeliveryError('rate-limit', response.status, retryAfter);
    }

    if ([401, 403, 404].includes(response.status)) {
      this.logger.error(
        `Webhook "${destino}" inválido ou revogado (HTTP ${response.status}). Confira ${DISCORD_ENV_POR_DESTINO[destino]}.`,
      );
      throw new DiscordDeliveryError('configuration', response.status);
    }

    if (response.status >= 400 && response.status < 500) {
      this.logger.error(`Discord recusou o payload de "${destino}" (HTTP ${response.status}).`);
      throw new DiscordDeliveryError('payload', response.status);
    }

    this.logger.warn(`Discord indisponível ao entregar "${destino}" (HTTP ${response.status}).`);
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
