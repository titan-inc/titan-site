import { DiscordDeliveryError, DiscordService } from './discord.service';

const APPLY = 'https://discord.com/api/webhooks/111/token-da-candidatura';
const MPLUS = 'https://discord.com/api/webhooks/222/token-do-mplus';

const payload = {
  embeds: [{ title: 'Teste', color: 1, fields: [], timestamp: new Date(0).toISOString() }],
  allowed_mentions: { parse: [] as [] },
};

describe('DiscordService', () => {
  const originalEnv = { ...process.env };
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DISCORD_APPLY_WEBHOOK_URL = APPLY;
    process.env.DISCORD_MPLUS_WEBHOOK_URL = MPLUS;
    globalThis.fetch = fetchMock;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('envia uma vez com timeout e aceita 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(new DiscordService().send('apply', payload)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(APPLY, expect.objectContaining({ method: 'POST' }));
    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    expect(calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('manda cada destino para o seu canal, e só para ele', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const service = new DiscordService();

    await service.send('apply', payload);
    await service.send('mplus', payload);

    const urls = (fetchMock.mock.calls as Array<[string, RequestInit]>).map(([url]) => url);
    expect(urls).toEqual([APPLY, MPLUS]);
  });

  it('destino sem webhook não cai no webhook do outro destino', async () => {
    delete process.env.DISCORD_MPLUS_WEBHOOK_URL;
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const service = new DiscordService();

    await expect(service.send('mplus', payload)).rejects.toMatchObject({ kind: 'unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();

    // E o destino que continua configurado segue funcionando.
    await expect(service.send('apply', payload)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(APPLY, expect.anything());
  });

  it('não faz chamada quando não está configurado', async () => {
    delete process.env.DISCORD_APPLY_WEBHOOK_URL;
    await expect(new DiscordService().send('apply', payload)).rejects.toMatchObject({
      kind: 'unconfigured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifica rate limit e lê retry_after', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ retry_after: 2.5 }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(new DiscordService().send('apply', payload)).rejects.toMatchObject({
      kind: 'rate-limit',
      retryAfter: 2.5,
    });
  });

  it.each([401, 403, 404])('classifica HTTP %s como falha de configuração', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    await expect(new DiscordService().send('apply', payload)).rejects.toMatchObject({
      kind: 'configuration',
      status,
    });
  });

  it('classifica outro 4xx como falha do payload', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 400 }));
    await expect(new DiscordService().send('apply', payload)).rejects.toMatchObject({
      kind: 'payload',
      status: 400,
    });
  });

  it('classifica 5xx e falha de rede como upstream sem vazar a URL', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(new DiscordService().send('apply', payload)).rejects.toMatchObject({
      kind: 'upstream',
    });

    fetchMock.mockRejectedValueOnce(new TypeError('falhou com URL secreta'));
    const error = await new DiscordService().send('apply', payload).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(DiscordDeliveryError);
    expect(String(error)).not.toContain('discord.com');
  });
});
