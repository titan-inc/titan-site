import { loadDiscordConfig } from './discord.config';

describe('loadDiscordConfig', () => {
  it('aceita um incoming webhook válido', () => {
    expect(
      loadDiscordConfig({
        DISCORD_APPLY_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/token',
      }),
    ).toEqual({ webhookUrl: 'https://discord.com/api/webhooks/123/token' });
  });

  it('aceita o host legado do Discord', () => {
    expect(
      loadDiscordConfig({
        DISCORD_APPLY_WEBHOOK_URL: 'https://discordapp.com/api/webhooks/123/token',
      }).webhookUrl,
    ).toBeDefined();
  });

  it('deixa o recurso desconfigurado quando a variável está ausente', () => {
    expect(loadDiscordConfig({})).toEqual({});
  });

  it.each([
    'https://example.com/api/webhooks/123/token',
    'http://discord.com/api/webhooks/123/token',
    'https://discord.com/channels/123',
    'não-é-url',
  ])('rejeita URL inválida: %s', (webhookUrl) => {
    expect(() => loadDiscordConfig({ DISCORD_APPLY_WEBHOOK_URL: webhookUrl })).toThrow(
      /DISCORD_APPLY_WEBHOOK_URL/,
    );
  });
});
