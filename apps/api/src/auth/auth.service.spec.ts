import type { Character, GuildCharacter } from '@prisma/client';
import type { BlizzardService } from '../blizzard/blizzard.service';
import type { AuthRepository, UserWithCharacters } from './auth.repository';
import { AuthService } from './auth.service';

/**
 * `toSessionUser` combina as **duas** fontes de oficial (Regra 4). Este arquivo
 * existe porque essa combinação é a única coisa que decide quem vê o histórico
 * dos outros, e ela não estava coberta.
 *
 * Cortes deste ambiente: acesso rank <= 4, oficial rank <= 2.
 */
process.env.GUILD_NAME ??= 'Titan Inc';
process.env.GUILD_REALM ??= 'Azralon';
process.env.GUILD_RANK_ACCESS_MAX ??= '4';
process.env.GUILD_OFFICER_RANK_MAX ??= '2';

// Nomes fictícios — CLAUDE.md proíbe nome real de membro em fixture. O nome
// dobra de id da identidade: depois da TIT-132 é por `characterId` que
// `isOfficerByGrants` compara, não mais por (nameKey, realmSlug).
const char = (id: string, rank: number): GuildCharacter & { character: Character } => ({
  id: `gc-${id}`,
  userId: 'u1',
  characterId: id,
  rank,
  createdAt: new Date('2026-08-10T12:00:00Z'),
  updatedAt: new Date('2026-08-10T12:00:00Z'),
  character: {
    id,
    nameKey: id,
    realmKey: 'azralon',
    name: id,
    realm: 'Azralon',
    class: null,
    createdAt: new Date('2026-08-10T12:00:00Z'),
    updatedAt: new Date('2026-08-10T12:00:00Z'),
  },
});

const user = (over: Partial<UserWithCharacters> = {}): UserWithCharacters =>
  ({
    id: 'u1',
    battletag: 'Fulano#1234',
    membership: 'member',
    guildRank: 5,
    characters: [char('fulano', 5)],
    verifiedAt: new Date('2026-08-10T12:00:00Z'),
    ...over,
  }) as UserWithCharacters;

describe('AuthService.toSessionUser', () => {
  const repo = { findOfficerGrants: jest.fn() };
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findOfficerGrants.mockResolvedValue([]);
    service = new AuthService({} as BlizzardService, repo as unknown as AuthRepository);
  });

  describe('isOfficer — duas fontes, basta uma', () => {
    it('só rank: dentro do corte de oficial, sem grant nenhum', async () => {
      const r = await service.toSessionUser(user({ guildRank: 2, characters: [char('chefe', 2)] }));
      expect(r.isOfficer).toBe(true);
    });

    it('só grant: fora do corte de oficial, mas concedido', async () => {
      // O raid leader em rank 4. É o caso que justifica a lista manual existir.
      repo.findOfficerGrants.mockResolvedValue(['rl']);
      const r = await service.toSessionUser(user({ guildRank: 4, characters: [char('rl', 4)] }));
      expect(r.isOfficer).toBe(true);
    });

    it('as duas ao mesmo tempo', async () => {
      repo.findOfficerGrants.mockResolvedValue(['chefe']);
      const r = await service.toSessionUser(user({ guildRank: 1, characters: [char('chefe', 1)] }));
      expect(r.isOfficer).toBe(true);
    });

    it('nenhuma: membro comum não vira oficial', async () => {
      const r = await service.toSessionUser(user({ guildRank: 5 }));
      expect(r.isOfficer).toBe(false);
    });
  });

  it('rank 3 e 4 entram na área interna e NÃO são oficiais', async () => {
    // Os dois gates são independentes. Se este teste cair, passar do corte de
    // acesso passou a dar decisões de liderança junto.
    for (const rank of [3, 4]) {
      const r = await service.toSessionUser(user({ guildRank: rank }));
      expect(r.hasInternalAccess).toBe(true);
      expect(r.isOfficer).toBe(false);
    }
  });

  it('grant sozinho não dá área interna a quem está fora do corte de acesso', async () => {
    // isOfficer verdadeiro com hasInternalAccess falso: isActingOfficer barra.
    repo.findOfficerGrants.mockResolvedValue(['social']);
    const r = await service.toSessionUser(user({ guildRank: 7, characters: [char('social', 7)] }));
    expect(r.isOfficer).toBe(true);
    expect(r.hasInternalAccess).toBe(false);
  });

  it('não-membro não é oficial nem com grant', async () => {
    // Sair da guilda derruba tudo, mesmo que ninguém revogue a concessão.
    repo.findOfficerGrants.mockResolvedValue(['exmembro']);
    const r = await service.toSessionUser(
      user({ membership: 'not_member', guildRank: null, characters: [] }),
    );
    expect(r.isOfficer).toBe(false);
    expect(r.hasInternalAccess).toBe(false);
  });

  it('promove pelo MELHOR rank da conta, não pelo personagem que logou', async () => {
    // Agregação por pessoa (Regra 4): o alt em rank 2 decide.
    const r = await service.toSessionUser(
      user({ guildRank: 2, characters: [char('altzinho', 7), char('main', 2)] }),
    );
    expect(r.isOfficer).toBe(true);
    expect(r.matchedCharacter?.name).toBe('main');
  });

  it('nunca vaza token da Blizzard na projeção', async () => {
    const r = await service.toSessionUser(user());
    expect(Object.keys(r)).not.toContain('accessToken');
    expect(Object.keys(r)).not.toContain('refreshToken');
  });
});
