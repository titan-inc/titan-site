import { buildApplicationEmbed, sanitizeDiscordText } from './embed';

const candidatura = {
  characterRealm: 'Thrall — Azralon',
  roleSpec: 'Tank / Protection Warrior',
  contact: 'Discord: thrall.azeroth',
};

describe('buildApplicationEmbed', () => {
  it('mantém ordem fixa, timestamp do servidor e bloqueia todas as menções', () => {
    const payload = buildApplicationEmbed(
      {
        ...candidatura,
        additionalInfo: '@everyone @here <@&123456789>',
      },
      new Date('2026-08-09T18:30:00.000Z'),
    );

    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0]).toMatchObject({
      timestamp: '2026-08-09T18:30:00.000Z',
      fields: [
        { name: 'Personagem / realm', inline: false },
        { name: 'Role / spec', inline: true },
        { name: 'Contato', inline: true },
      ],
    });
    expect(payload.embeds[0]?.description).toContain('@everyone');
    expect(payload.embeds[0]?.description).toContain('@here');
    expect(payload.embeds[0]?.description).toContain('<@&123456789>');
  });

  it('escapa markdown e impede links com texto divergente do destino', () => {
    const description = buildApplicationEmbed({
      ...candidatura,
      additionalInfo: '`código` **forte** _itálico_ [seguro](https://evil.example)',
    }).embeds[0]?.description;

    expect(description).toBe(
      '\\`código\\` \\*\\*forte\\*\\* \\_itálico\\_ \\[seguro\\]\\(https://evil.example\\)',
    );
  });

  it('mantém URL crua legível', () => {
    expect(
      buildApplicationEmbed({
        ...candidatura,
        additionalInfo: 'https://www.warcraftlogs.com/reports/abc',
      }).embeds[0]?.description,
    ).toBe('https://www.warcraftlogs.com/reports/abc');
  });

  it('trunca depois de escapar e marca o corte', () => {
    const escaped = sanitizeDiscordText('*'.repeat(2_000), 1_000);
    expect(escaped).toHaveLength(1_000);
    expect(escaped.endsWith('…')).toBe(true);
    expect(escaped).toMatch(/^\\\*/);
  });

  it.each([undefined, '', '   \n '])('omite descrição vazia (%s)', (additionalInfo) => {
    const embed = buildApplicationEmbed({ ...candidatura, additionalInfo }).embeds[0];
    expect(embed).not.toHaveProperty('description');
  });

  it('remove controles, zero-width e excesso de linhas vazias', () => {
    const embed = buildApplicationEmbed({
      ...candidatura,
      additionalInfo: 'antes\u0000\u0007\u200B\uFEFFdepois\n\n\n\nfim',
    }).embeds[0];
    expect(embed?.description).toBe('antesdepois\n\nfim');
  });

  it('escapa citação apenas no início da linha', () => {
    expect(sanitizeDiscordText('> falsa citação\ntexto > normal', 100)).toBe(
      '\\> falsa citação\ntexto > normal',
    );
  });
});
