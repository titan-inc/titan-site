import { loadDiscordConfig } from './discord.config';

const APPLY = 'https://discord.com/api/webhooks/111/token-da-candidatura';
const MPLUS = 'https://discord.com/api/webhooks/222/token-do-mplus';

describe('loadDiscordConfig', () => {
  it('aceita um incoming webhook válido por destino', () => {
    expect(
      loadDiscordConfig({ DISCORD_APPLY_WEBHOOK_URL: APPLY, DISCORD_MPLUS_WEBHOOK_URL: MPLUS }),
    ).toEqual({ webhooks: { apply: APPLY, mplus: MPLUS } });
  });

  it('aceita o host legado do Discord', () => {
    expect(
      loadDiscordConfig({
        DISCORD_APPLY_WEBHOOK_URL: 'https://discordapp.com/api/webhooks/123/token',
      }).webhooks.apply,
    ).toBeDefined();
  });

  it('deixa o recurso desconfigurado quando a variável está ausente', () => {
    expect(loadDiscordConfig({})).toEqual({ webhooks: {} });
  });

  it('um destino ausente não desabilita o outro', () => {
    expect(loadDiscordConfig({ DISCORD_APPLY_WEBHOOK_URL: APPLY }).webhooks).toEqual({
      apply: APPLY,
    });
    expect(loadDiscordConfig({ DISCORD_MPLUS_WEBHOOK_URL: MPLUS }).webhooks).toEqual({
      mplus: MPLUS,
    });
  });

  it('recusa o mesmo webhook em dois destinos', () => {
    expect(() =>
      loadDiscordConfig({ DISCORD_APPLY_WEBHOOK_URL: APPLY, DISCORD_MPLUS_WEBHOOK_URL: APPLY }),
    ).toThrow(/próprio canal/);
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
    expect(() => loadDiscordConfig({ DISCORD_MPLUS_WEBHOOK_URL: webhookUrl })).toThrow(
      /DISCORD_MPLUS_WEBHOOK_URL/,
    );
  });

  it('lê o cargo de M+ e recusa valor que não é id', () => {
    expect(loadDiscordConfig({ DISCORD_MPLUS_ROLE_ID: '123456789012345678' }).mplusRoleId).toBe(
      '123456789012345678',
    );
    expect(() => loadDiscordConfig({ DISCORD_MPLUS_ROLE_ID: '<@&123>' })).toThrow(
      /DISCORD_MPLUS_ROLE_ID/,
    );
  });
});
