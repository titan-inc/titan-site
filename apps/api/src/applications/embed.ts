import type { CreateApplication } from '@titan/shared';
import type { DiscordWebhookPayload } from '../discord/discord.service';

const EMBED_COLOR = 3_066_993;

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/** Limpa conteúdo humano antes de colocá-lo na sintaxe de embeds do Discord. */
export function sanitizeDiscordText(value: string, limit: number): string {
  const withoutControls = [...value.replace(/\r\n?/g, '\n')]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return character === '\n' || (code >= 32 && code !== 127 && !(code >= 128 && code <= 159));
    })
    .join('');

  const normalized = withoutControls
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_~|()[\]])/g, '\\$1')
    .replace(/^>/gm, '\\>');

  return truncate(normalized, limit);
}

export function buildApplicationEmbed(
  application: CreateApplication,
  now: Date = new Date(),
): DiscordWebhookPayload {
  const characterRealm = sanitizeDiscordText(application.characterRealm, 1_000);
  const roleSpec = sanitizeDiscordText(application.roleSpec, 1_000);
  const contact = sanitizeDiscordText(application.contact, 1_000);
  const additionalInfo = application.additionalInfo?.trim();

  const embed: DiscordWebhookPayload['embeds'][number] = {
    title: sanitizeDiscordText(`Nova candidatura — ${application.characterRealm}`, 200),
    color: EMBED_COLOR,
    fields: [
      { name: 'Personagem / realm', value: characterRealm, inline: false },
      { name: 'Role / spec', value: roleSpec, inline: true },
      { name: 'Contato', value: contact, inline: true },
    ],
    timestamp: now.toISOString(),
  };

  if (additionalInfo) {
    embed.description = sanitizeDiscordText(additionalInfo, 4_000);
  }

  return {
    username: 'Candidaturas',
    embeds: [embed],
    allowed_mentions: { parse: [] },
  };
}
