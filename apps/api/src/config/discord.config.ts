export interface DiscordConfig {
  webhookUrl?: string;
}

/**
 * Lê a configuração isolada da entrega de candidaturas.
 *
 * A ausência não derruba a API inteira: recrutamento fica indisponível, mas
 * roster, login e área interna continuam funcionando. Valor presente e
 * inválido, por outro lado, é erro de configuração e falha de forma barulhenta.
 */
export function loadDiscordConfig(env: NodeJS.ProcessEnv = process.env): DiscordConfig {
  const raw = env.DISCORD_APPLY_WEBHOOK_URL?.trim();
  if (!raw) return {};

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      'DISCORD_APPLY_WEBHOOK_URL inválida. Esperada uma URL de incoming webhook do Discord.',
    );
  }

  const hostValido =
    url.protocol === 'https:' && ['discord.com', 'discordapp.com'].includes(url.hostname);
  if (!hostValido || !url.pathname.startsWith('/api/webhooks/')) {
    throw new Error(
      'DISCORD_APPLY_WEBHOOK_URL inválida. Use uma URL HTTPS de discord.com ou discordapp.com com caminho /api/webhooks/.',
    );
  }

  return { webhookUrl: url.toString() };
}
