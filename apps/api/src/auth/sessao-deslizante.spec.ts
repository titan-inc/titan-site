import type { BlizzardService } from '../blizzard/blizzard.service';
import type { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';

/**
 * A sessão dura uma semana contada do último uso (TIT-148).
 *
 * O que estes testes seguram é o par: a semana só vale se `resolveSession`
 * empurrar a validade, e o `UPDATE` só é aceitável se não acontecer em todo
 * request. Um sem o outro é regressão silenciosa — ninguém percebe uma sessão
 * que deixou de deslizar até as pessoas começarem a relogar de novo.
 */
process.env.GUILD_NAME ??= 'Titan Inc';
process.env.GUILD_REALM ??= 'Azralon';
process.env.GUILD_RANK_ACCESS_MAX ??= '4';
process.env.GUILD_OFFICER_RANK_MAX ??= '2';

const SEMANA = 7 * 24 * 60 * 60 * 1000;
const HORA = 60 * 60 * 1000;
const AGORA = new Date('2026-09-01T12:00:00Z').getTime();

describe('sessão deslizante', () => {
  const repo = {
    findSessionWithUser: jest.fn(),
    touchSession: jest.fn(),
    deleteSession: jest.fn(),
  };
  let service: AuthService;

  /** Sessão que ainda tem `restaMs` de vida. */
  const sessao = (restaMs: number) => ({
    id: 's1',
    userId: 'u1',
    expiresAt: new Date(AGORA + restaMs),
    user: { id: 'u1', characters: [] },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(AGORA);
    service = new AuthService({} as BlizzardService, repo as unknown as AuthRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a semana é o TTL, e o cookie do browser dura mais que ela', () => {
    // Igualar os dois quebraria o deslizamento: o browser jogaria o cookie fora
    // com a sessão ainda viva no banco, que é quem decide.
    expect(service.sessionCookieMaxAgeMs).toBeGreaterThan(SEMANA);
  });

  it('empurra a validade para uma semana a partir de agora', async () => {
    repo.findSessionWithUser.mockResolvedValue(sessao(2 * 24 * HORA));

    await service.resolveSession('s1');

    expect(repo.touchSession).toHaveBeenCalledWith('s1', new Date(AGORA + SEMANA));
  });

  // Uma navegação da área interna dispara vários requests. Sem a folga, cada um
  // seria um UPDATE no banco por uma diferença de segundos.
  it('NÃO escreve quando a validade mal andou', async () => {
    repo.findSessionWithUser.mockResolvedValue(sessao(SEMANA - 60 * 1000));

    await service.resolveSession('s1');

    expect(repo.touchSession).not.toHaveBeenCalled();
  });

  it('volta a escrever depois de uma hora de uso', async () => {
    repo.findSessionWithUser.mockResolvedValue(sessao(SEMANA - HORA));

    await service.resolveSession('s1');

    expect(repo.touchSession).toHaveBeenCalled();
  });

  it('sessão vencida é apagada e não devolve usuário', async () => {
    repo.findSessionWithUser.mockResolvedValue(sessao(-HORA));

    await expect(service.resolveSession('s1')).resolves.toBeNull();
    expect(repo.deleteSession).toHaveBeenCalledWith('s1');
    expect(repo.touchSession).not.toHaveBeenCalled();
  });

  // O job de revalidação apaga a sessão de quem saiu da guilda. Se o
  // deslizamento a ressuscitasse, revogar membership pararia de valer na hora —
  // que é a razão de a sessão ter estado no banco em vez de ser JWT.
  it('sessão que não existe mais não é recriada pelo deslizamento', async () => {
    repo.findSessionWithUser.mockResolvedValue(null);

    await expect(service.resolveSession('s1')).resolves.toBeNull();
    expect(repo.touchSession).not.toHaveBeenCalled();
  });

  it('sem cookie não consulta o banco', async () => {
    await expect(service.resolveSession(undefined)).resolves.toBeNull();
    expect(repo.findSessionWithUser).not.toHaveBeenCalled();
  });
});
