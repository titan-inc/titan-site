import { WowAuditService } from './wowaudit.service';

/**
 * O Titan Roster com a procedência junto (spec do Titan Bet, §5.4 e §12).
 *
 * O Ready congela os candidatos a partir daqui e não pode congelar uma lista
 * velha em silêncio: o `getTeamCharacters` devolve o cache anterior quando a
 * chamada falha, sem avisar. O snapshot diz se é esse o caso.
 */
const TIME = [
  { name: 'Tanque', realm: 'Azralon', class: 'Warrior', role: 'Tank' },
  { name: 'Cura', realm: 'Area 52', class: 'Priest', role: 'Heal' },
];

function resposta(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('WowAuditService — Titan Roster com procedência', () => {
  let fetchSpy: jest.SpyInstance;
  const chaveOriginal = process.env.WOW_AUDIT_KEY;

  beforeEach(() => {
    process.env.WOW_AUDIT_KEY = 'chave-de-teste';
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.env.WOW_AUDIT_KEY = chaveOriginal;
  });

  it('resposta nova: stale = false, com o instante da leitura', async () => {
    fetchSpy.mockResolvedValueOnce(resposta(TIME));
    const antes = Date.now();

    const snapshot = await new WowAuditService().getTeamCharactersSnapshot(true);

    expect(snapshot.stale).toBe(false);
    expect(snapshot.fetchedAt).toBeGreaterThanOrEqual(antes);
    expect(snapshot.characters).toEqual([
      { name: 'Tanque', realm: 'Azralon', wowClass: 'Warrior', role: 'Tank' },
      { name: 'Cura', realm: 'Area 52', wowClass: 'Priest', role: 'Heal' },
    ]);
  });

  it('falha de rede com cache anterior: devolve o cache marcado stale', async () => {
    const service = new WowAuditService();
    fetchSpy.mockResolvedValueOnce(resposta(TIME));
    const primeiro = await service.getTeamCharactersSnapshot(true);

    fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));
    const segundo = await service.getTeamCharactersSnapshot(true);

    expect(segundo.stale).toBe(true);
    expect(segundo.characters).toEqual(primeiro.characters);
    expect(segundo.fetchedAt).toBe(primeiro.fetchedAt);
  });

  it('HTTP de erro com cache anterior: também stale', async () => {
    const service = new WowAuditService();
    fetchSpy.mockResolvedValueOnce(resposta(TIME));
    await service.getTeamCharactersSnapshot(true);

    fetchSpy.mockResolvedValueOnce(new Response('erro', { status: 502 }));
    expect((await service.getTeamCharactersSnapshot(true)).stale).toBe(true);
  });

  it('falha sem cache anterior: lança', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(new WowAuditService().getTeamCharactersSnapshot(true)).rejects.toThrow(
      /sem cache|não há cache/i,
    );
  });

  it('getTeamCharacters continua devolvendo a lista, mesmo do cache velho', async () => {
    const service = new WowAuditService();
    fetchSpy.mockResolvedValueOnce(resposta(TIME));
    const primeira = await service.getTeamCharacters(true);

    fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await service.getTeamCharacters(true)).toEqual(primeira);
  });
});
