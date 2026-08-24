/**
 * Limpeza de texto humano antes de entrar na sintaxe de embeds do Discord.
 *
 * Mora no módulo do Discord, e não no de candidaturas, porque é regra do
 * **formato de fio** — vale para toda mensagem que a guilda publica, e a
 * segunda mensagem (vaga de M+) precisa exatamente das mesmas garantias.
 *
 * Não substitui `allowed_mentions: { parse: [] }`: escapar markdown não impede
 * o Discord de interpretar `@everyone`. São duas defesas independentes, e as
 * duas são obrigatórias.
 */

/** Caracteres invisíveis: usados para contrabandear texto passando por leitor. */
const INVISIVEIS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

export function truncate(value: string, limit: number): string {
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
    .replace(INVISIVEIS, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_~|()[\]])/g, '\\$1')
    .replace(/^>/gm, '\\>');

  // Truncar DEPOIS de escapar: cortar antes deixaria uma barra invertida órfã
  // no fim, que reescaparia o caractere seguinte.
  return truncate(normalized, limit);
}
