import type { CreateApplication } from '@titan/shared';
import type { DiscordWebhookPayload } from '../discord/discord.service';
import { sanitizeDiscordText } from '../discord/sanitize';

const EMBED_COLOR = 3_066_993;

// A sanitização mora no módulo do Discord desde que passou a existir uma
// segunda mensagem (vaga de M+): é regra do formato de fio, não de
// candidatura. Reexportada para quem já importava deste caminho.
export { sanitizeDiscordText };

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
