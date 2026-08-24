import { toCharacterKey, toRealmMatchKey } from '@titan/shared';
import type { BlizzardService, RosterMember, RosterSnapshot } from '../blizzard/blizzard.service';
import type {
  CharacterToRevalidate,
  MemberToRevalidate,
  MembershipRepository,
} from './membership.repository';
import { MembershipService } from './membership.service';

// Dados fictícios de propósito: nada de nome real de membro em fixture — ver
// a seção de segredos do CLAUDE.md.
const rosterMember = (name: string, realmSlug: string, rank: number): RosterMember => ({
  name,
  nameKey: name.toLowerCase(),
  realmSlug,
  rank,
});

/**
 * Personagem guardado no banco. `rank` é o que a última rodada viu.
 *
 * `nameKey`/`realmKey` são as chaves da identidade (Regra 6) — a mesma
 * normalização que `Character` guarda, não o que foi digitado.
 */
const dbChar = (name: string, rank: number, realm = 'Azralon'): CharacterToRevalidate => ({
  id: `char-${name.toLowerCase()}`,
  nameKey: toCharacterKey(name),
  realmKey: toRealmMatchKey(realm),
  rank,
});

const dbMember = (over: Partial<MemberToRevalidate> = {}): MemberToRevalidate => ({
  id: 'user-1',
  guildRank: 4,
  characters: [dbChar('ferrolhx', 4)],
  ...over,
});

const snapshot = (members: RosterMember[], stale = false): RosterSnapshot => ({
  members,
  fetchedAt: Date.now(),
  stale,
});

describe('MembershipService', () => {
  const blizzard = { getGuildRosterSnapshot: jest.fn() };
  const repo = {
    findMembers: jest.fn(),
    revokeMembership: jest.fn(),
    updateRank: jest.fn(),
    touchVerified: jest.fn(),
    deleteCharacters: jest.fn(),
    updateCharacterRank: jest.fn(),
  };

  let service: MembershipService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.revokeMembership.mockResolvedValue(0);
    repo.updateRank.mockResolvedValue(undefined);
    repo.touchVerified.mockResolvedValue(undefined);
    repo.deleteCharacters.mockResolvedValue(0);
    repo.updateCharacterRank.mockResolvedValue(undefined);
    repo.findMembers.mockResolvedValue([]);

    service = new MembershipService(
      blizzard as unknown as BlizzardService,
      repo as unknown as MembershipRepository,
    );
  });

  it('revoga quem não está mais no roster e apaga as sessões', async () => {
    blizzard.getGuildRosterSnapshot.mockResolvedValue(
      snapshot([rosterMember('ficou', 'azralon', 4)]),
    );
    repo.findMembers.mockResolvedValue([
      dbMember({ id: 'ficou', characters: [dbChar('ficou', 4)] }),
      dbMember({ id: 'saiu', characters: [dbChar('saiu', 4)] }),
    ]);
    repo.revokeMembership.mockResolvedValue(2);

    const result = await service.revalidateAll();

    expect(repo.revokeMembership).toHaveBeenCalledWith(['saiu']);
    expect(result).toMatchObject({ status: 'ok', revoked: 1, sessionsDeleted: 2 });
  });

  it('busca roster fresco, não o cache da rodada anterior', async () => {
    blizzard.getGuildRosterSnapshot.mockResolvedValue(snapshot([rosterMember('a', 'azralon', 1)]));

    await service.revalidateAll();

    expect(blizzard.getGuildRosterSnapshot).toHaveBeenCalledWith(true);
  });

  describe('não revoga ninguém quando o roster não é confiável', () => {
    beforeEach(() => {
      repo.findMembers.mockResolvedValue([dbMember({ id: 'membro-legitimo' })]);
    });

    it('roster veio do cache porque a Blizzard falhou', async () => {
      // O personagem NÃO está neste roster: se o job não checasse `stale`, este
      // membro perderia acesso por causa de uma falha de API.
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([rosterMember('outro', 'azralon', 1)], true),
      );

      const result = await service.revalidateAll();

      if (result.status !== 'aborted') throw new Error('esperava a rodada abortada');
      expect(result.reason).toMatch(/cache/);
      expect(repo.revokeMembership).not.toHaveBeenCalled();
    });

    it('roster vazio', async () => {
      blizzard.getGuildRosterSnapshot.mockResolvedValue(snapshot([]));

      const result = await service.revalidateAll();

      expect(result).toMatchObject({ status: 'aborted' });
      expect(repo.revokeMembership).not.toHaveBeenCalled();
    });

    it('a chamada à Blizzard lança', async () => {
      blizzard.getGuildRosterSnapshot.mockRejectedValue(new Error('HTTP 503'));

      await expect(service.revalidateAll()).rejects.toThrow('HTTP 503');
      expect(repo.revokeMembership).not.toHaveBeenCalled();
    });

    it('membro sem personagem casado (não dá para verificar)', async () => {
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([rosterMember('a', 'azralon', 1)]),
      );
      repo.findMembers.mockResolvedValue([dbMember({ id: 'sem-char', characters: [] })]);

      const result = await service.revalidateAll();

      expect(result).toMatchObject({ status: 'ok', revoked: 0, unverifiable: 1 });
      expect(repo.revokeMembership).toHaveBeenCalledWith([]);
    });
  });

  it('atualiza o rank de quem foi promovido no jogo', async () => {
    blizzard.getGuildRosterSnapshot.mockResolvedValue(
      snapshot([rosterMember('ferrolhx', 'azralon', 1)]),
    );
    repo.findMembers.mockResolvedValue([dbMember({ id: 'promovido', guildRank: 4 })]);

    const result = await service.revalidateAll();

    expect(repo.updateRank).toHaveBeenCalledWith('promovido', 1);
    expect(repo.revokeMembership).toHaveBeenCalledWith([]);
    expect(result).toMatchObject({ ranksUpdated: 1 });
  });

  it('só marca verificado quem continua igual', async () => {
    blizzard.getGuildRosterSnapshot.mockResolvedValue(
      snapshot([rosterMember('ferrolhx', 'azralon', 4)]),
    );
    repo.findMembers.mockResolvedValue([dbMember({ id: 'igual', guildRank: 4 })]);

    await service.revalidateAll();

    expect(repo.touchVerified).toHaveBeenCalledWith(['igual']);
    expect(repo.updateRank).not.toHaveBeenCalled();
  });

  it('compara realm normalizado, não string crua', async () => {
    // Linha escrita à mão no banco, com o realm como nome exibido. Comparação
    // crua falharia — silenciosamente, revogando um membro de verdade.
    blizzard.getGuildRosterSnapshot.mockResolvedValue(
      snapshot([rosterMember('valdrakken', 'area-52', 3)]),
    );
    repo.findMembers.mockResolvedValue([
      dbMember({
        id: 'realm-cru',
        guildRank: 3,
        characters: [dbChar('Valdrakken', 3, 'Area 52')],
      }),
    ]);

    const result = await service.revalidateAll();

    expect(repo.revokeMembership).toHaveBeenCalledWith([]);
    expect(result).toMatchObject({ revoked: 0 });
  });

  it('não confunde personagens que só diferem por acento', async () => {
    // Caso real do roster: Shrëwd (rank 5) e Shrèwd (rank 7) são pessoas
    // diferentes. Com a chave sem acento os dois colapsavam em "shrewd", e o
    // Map deixava só o último — quem é rank 5 era lido como rank 7 e perdia o
    // acesso à área interna.
    blizzard.getGuildRosterSnapshot.mockResolvedValue(
      snapshot([
        rosterMember('Shrëwd', 'azralon', 5),
        rosterMember('Shrêwd', 'azralon', 5),
        rosterMember('Shrèwd', 'azralon', 7),
      ]),
    );
    repo.findMembers.mockResolvedValue([
      dbMember({ id: 'acentuado', guildRank: 5, characters: [dbChar('Shrëwd', 5)] }),
    ]);

    const result = await service.revalidateAll();

    expect(repo.revokeMembership).toHaveBeenCalledWith([]);
    expect(repo.updateRank).not.toHaveBeenCalled();
    expect(result).toMatchObject({ revoked: 0, ranksUpdated: 0 });
  });

  describe('conta com vários personagens', () => {
    it('NÃO revoga quem tirou um alt mas continua com outro no roster', async () => {
      // O bug que motivou a tabela: com um personagem só gravado, tirar um alt
      // da guilda derrubava o acesso de um membro legítimo — em silêncio.
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([rosterMember('main', 'azralon', 4)]),
      );
      repo.findMembers.mockResolvedValue([
        dbMember({
          id: 'tirou-alt',
          guildRank: 4,
          characters: [dbChar('main', 4), dbChar('alt', 7)],
        }),
      ]);

      const result = await service.revalidateAll();

      expect(repo.revokeMembership).toHaveBeenCalledWith([]);
      expect(repo.deleteCharacters).toHaveBeenCalledWith(['char-alt']);
      expect(result).toMatchObject({ revoked: 0 });
    });

    it('revoga só quando NENHUM personagem sobra no roster', async () => {
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([rosterMember('outra-pessoa', 'azralon', 4)]),
      );
      repo.findMembers.mockResolvedValue([
        dbMember({ id: 'saiu-de-vez', characters: [dbChar('main', 4), dbChar('alt', 7)] }),
      ]);

      const result = await service.revalidateAll();

      expect(repo.revokeMembership).toHaveBeenCalledWith(['saiu-de-vez']);
      expect(result).toMatchObject({ revoked: 1 });
    });

    it('o rank da conta é o do melhor personagem, não o do primeiro', async () => {
      // O alt de rank 2 é quem manda, mesmo vindo depois na lista.
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([rosterMember('main', 'azralon', 5), rosterMember('alt', 'azralon', 2)]),
      );
      repo.findMembers.mockResolvedValue([
        dbMember({
          id: 'multi',
          guildRank: 5,
          characters: [dbChar('main', 5), dbChar('alt', 2)],
        }),
      ]);

      await service.revalidateAll();

      expect(repo.updateRank).toHaveBeenCalledWith('multi', 2);
    });

    it('sair do personagem de maior rank rebaixa a conta sem revogar', async () => {
      // Deixou o main de rank 2 e ficou só com o alt de rank 6: continua na
      // guilda, mas perde o acesso à área interna no próximo request.
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([rosterMember('alt', 'azralon', 6)]),
      );
      repo.findMembers.mockResolvedValue([
        dbMember({
          id: 'rebaixou',
          guildRank: 2,
          characters: [dbChar('main', 2), dbChar('alt', 6)],
        }),
      ]);

      const result = await service.revalidateAll();

      expect(repo.revokeMembership).toHaveBeenCalledWith([]);
      expect(repo.updateRank).toHaveBeenCalledWith('rebaixou', 6);
      expect(result).toMatchObject({ revoked: 0 });
    });

    it('atualiza o rank do personagem, não só o da conta', async () => {
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([rosterMember('main', 'azralon', 4), rosterMember('alt', 'azralon', 5)]),
      );
      repo.findMembers.mockResolvedValue([
        dbMember({ id: 'multi', guildRank: 4, characters: [dbChar('main', 4), dbChar('alt', 7)] }),
      ]);

      await service.revalidateAll();

      expect(repo.updateCharacterRank).toHaveBeenCalledWith('char-alt', 5);
    });
  });

  it('a rodada agendada não deixa exceção escapar', async () => {
    blizzard.getGuildRosterSnapshot.mockRejectedValue(new Error('Blizzard fora do ar'));

    await expect(service.revalidateScheduled()).resolves.toBeUndefined();
  });
});
