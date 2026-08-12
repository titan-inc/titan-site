/**
 * Destinos de entrega no Discord. Um canal por destino, nunca compartilhado.
 *
 * É um tipo fechado de propósito: `send()` recebe um destes literais, então
 * nenhum caminho de código consegue mandar candidatura para o canal de M+ por
 * um erro de digitação — o typecheck barra antes.
 */
export const DISCORD_DESTINOS = ['apply', 'mplus'] as const;
export type DiscordDestino = (typeof DISCORD_DESTINOS)[number];

/** Qual variável de ambiente carrega o webhook de cada destino. */
export const DISCORD_ENV_POR_DESTINO: Record<DiscordDestino, string> = {
  apply: 'DISCORD_APPLY_WEBHOOK_URL',
  mplus: 'DISCORD_MPLUS_WEBHOOK_URL',
};

export interface DiscordConfig {
  /** Webhook por destino. Ausente = aquele destino está indisponível. */
  webhooks: Partial<Record<DiscordDestino, string>>;

  /**
   * Cargo a mencionar no anúncio de vaga de M+, se houver.
   *
   * Id fixo em configuração, nunca texto que alguém digitou: a menção vai em
   * `allowed_mentions.roles`, e `parse` continua vazio. Ver seção 9 da spec.
   */
  mplusRoleId?: string;
}

/**
 * Lê a configuração das entregas no Discord.
 *
 * A ausência de um webhook não derruba a API inteira: aquele destino fica
 * indisponível e o resto do site continua funcionando. Cada destino é
 * independente — sem o de M+, candidatura continua entregando, e vice-versa.
 *
 * Valor presente e inválido, por outro lado, é erro de configuração e falha de
 * forma barulhenta, inclusive dois destinos apontando para o mesmo canal.
 */
export function loadDiscordConfig(env: NodeJS.ProcessEnv = process.env): DiscordConfig {
  const webhooks: Partial<Record<DiscordDestino, string>> = {};

  for (const destino of DISCORD_DESTINOS) {
    const variavel = DISCORD_ENV_POR_DESTINO[destino];
    const url = parseWebhookUrl(env[variavel]?.trim(), variavel);
    if (url) webhooks[destino] = url;
  }

  // Mesma URL nos dois destinos é o incidente que a Regra 4 descreve: a
  // candidatura carrega Discord tag e texto pessoal de gente de fora, e o canal
  // de M+ é aberto à guilda. Melhor não subir do que entregar no canal errado.
  const urls = Object.values(webhooks);
  if (urls.length > 1 && new Set(urls).size !== urls.length) {
    throw new Error(
      'Webhooks do Discord repetidos: cada destino precisa do seu próprio canal. ' +
        'Candidatura é canal privado da liderança; M+ é canal aberto da guilda.',
    );
  }

  const mplusRoleId = env.DISCORD_MPLUS_ROLE_ID?.trim();
  if (mplusRoleId && !/^\d{5,25}$/.test(mplusRoleId)) {
    throw new Error('DISCORD_MPLUS_ROLE_ID inválido. Esperado o id numérico do cargo no Discord.');
  }

  return mplusRoleId ? { webhooks, mplusRoleId } : { webhooks };
}

function parseWebhookUrl(raw: string | undefined, variavel: string): string | undefined {
  if (!raw) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${variavel} inválida. Esperada uma URL de incoming webhook do Discord.`);
  }

  const hostValido =
    url.protocol === 'https:' && ['discord.com', 'discordapp.com'].includes(url.hostname);
  if (!hostValido || !url.pathname.startsWith('/api/webhooks/')) {
    throw new Error(
      `${variavel} inválida. Use uma URL HTTPS de discord.com ou discordapp.com com caminho /api/webhooks/.`,
    );
  }

  return url.toString();
}
