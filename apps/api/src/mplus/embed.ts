import { descreverFaixaDeKey, descreverVagas, type Vaga } from '@titan/shared';
import type { DiscordWebhookPayload } from '../discord/discord.service';
import { sanitizeDiscordText } from '../discord/sanitize';

/** Roxo de M+, para o anúncio não se parecer com o embed de candidatura. */
const EMBED_COLOR = 10_181_046;

export interface MplusEmbedOptions {
  /** Base pública do site, para o embed linkar a página da vaga (Regra 7). */
  webUrl: string;
  /** Fuso da guilda, só para o título. Os campos usam o do leitor. */
  timezone: string;
  /** Cargo a mencionar, quando configurado. */
  roleId?: string;
}

/** Página exata da vaga — Regra 7: linka fundo, nunca na home. */
export function urlDaVaga(webUrl: string, id: string): string {
  return `${webUrl.replace(/\/+$/, '')}/interno/mplus/${id}`;
}

/**
 * Quando a key é, escrito no fuso da guilda.
 *
 * Só o **título** usa isto: título de embed não renderiza o timestamp do
 * Discord, então ali é preciso escolher um fuso. O campo "Quando" logo abaixo
 * usa `<t:…>`, que cada pessoa lê no fuso dela — quem mora fora vê a hora
 * certa mesmo que o título fale em horário de Brasília.
 */
function quandoNoFusoDaGuilda(quando: Date, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  })
    .format(quando)
    .replace(',', '');
}

/**
 * O anúncio da vaga.
 *
 * Diferente do embed de candidatura em dois pontos, e os dois são de propósito:
 * quem anuncia é **membro identificado** (sem isso ninguém sabe a quem
 * responder), e o cargo do canal pode ser mencionado — via
 * `allowed_mentions.roles` com id fixo em configuração, **nunca** via `parse`,
 * e nunca a partir de texto digitado.
 */
export function buildVagaEmbed(vaga: Vaga, options: MplusEmbedOptions): DiscordWebhookPayload {
  const quando = new Date(vaga.quando);
  const unix = Math.floor(quando.getTime() / 1_000);

  const fields: DiscordWebhookPayload['embeds'][number]['fields'] = [
    {
      name: 'Quando',
      // <t:…:F> e <t:…:R> renderizam no fuso de quem lê — é a única forma de
      // "21h" não ser ambíguo entre pessoas que precisam se combinar.
      value: `<t:${String(unix)}:F> (<t:${String(unix)}:R>)`,
      inline: false,
    },
    { name: 'Key', value: descreverFaixaDeKey(vaga.keyMin, vaga.keyMax), inline: true },
    { name: 'Quem chamou', value: sanitizeDiscordText(vaga.criadaPor, 1_000), inline: true },
  ];

  // Campo omitido quando o grupo tem tudo: o Discord recusa `value` vazio, e um
  // "—" seria ruído.
  if (vaga.faltando.length > 0) {
    fields.push({
      name: 'O grupo não tem',
      value: vaga.faltando.join(' + '),
      inline: true,
    });
  }

  const embed: DiscordWebhookPayload['embeds'][number] = {
    title: `Falta ${descreverVagas(vaga.vagas)} — ${quandoNoFusoDaGuilda(quando, options.timezone)}`,
    url: urlDaVaga(options.webUrl, vaga.id),
    color: EMBED_COLOR,
    fields,
    timestamp: new Date(vaga.criadaEm).toISOString(),
  };

  const observacao = vaga.observacao?.trim();
  if (observacao) embed.description = sanitizeDiscordText(observacao, 4_000);

  return {
    // Sem `username` de propósito: a mensagem sai com o nome configurado no
    // próprio webhook, no Discord. Sobrescrever aqui tornaria "trocar o nome do
    // bot" uma mudança de código com deploy atrás, quando é ajuste de quem
    // cuida do canal — mesma lógica do corte de rank morar em configuração.
    ...(options.roleId ? { content: `<@&${options.roleId}>` } : {}),
    embeds: [embed],
    // `parse: []` sempre. `roles` é whitelist de um id que veio da
    // configuração, nunca de texto que alguém digitou.
    allowed_mentions: options.roleId ? { parse: [], roles: [options.roleId] } : { parse: [] },
  };
}
