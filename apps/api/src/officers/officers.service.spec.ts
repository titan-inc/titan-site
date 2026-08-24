import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Character } from '@prisma/client';
import type { BlizzardService, RosterMember, RosterSnapshot } from '../blizzard/blizzard.service';
import type { CharactersRepository } from '../characters/characters.repository';
import type { OfficerGrantWithCharacter, OfficersRepository } from './officers.repository';
import { OfficersService } from './officers.service';

// Dados fictícios de propósito — nada de nome real de membro em fixture, ver a
// seção de segredos do CLAUDE.md.
const rosterMember = (name: string, realmSlug: string, rank: number): RosterMember => ({
  name,
  nameKey: name.normalize('NFC').toLowerCase(),
  realmSlug,
  rank,
});

const snapshot = (members: RosterMember[]): RosterSnapshot => ({
  members,
  fetchedAt: Date.now(),
  stale: false,
});

const dbCharacter = (over: Partial<Character> = {}): Character => ({
  id: 'char-fulano',
  nameKey: 'fulano',
  realmKey: 'azralon',
  name: 'Fulano',
  realm: 'Azralon',
  class: null,
  createdAt: new Date('2026-08-09T12:00:00Z'),
  updatedAt: new Date('2026-08-09T12:00:00Z'),
  ...over,
});

const dbGrant = (
  over: {
    id?: string;
    grantedBy?: string;
    grantedAt?: Date;
    character?: Partial<Character>;
  } = {},
): OfficerGrantWithCharacter => {
  const character = dbCharacter(over.character);
  return {
    id: over.id ?? 'grant-1',
    characterId: character.id,
    grantedBy: over.grantedBy ?? 'Chefe#1234',
    grantedAt: over.grantedAt ?? new Date('2026-08-09T12:00:00Z'),
    character,
  };
};

/**
 * O service lê o corte de oficial de `loadGuildConfig()`, que valida o ambiente
 * inteiro e lança sem GUILD_NAME/GUILD_REALM. Definir aqui é mais honesto que
 * mockar o módulo: o teste roda contra o mesmo parser que a produção usa, então
 * um corte inválido quebraria aqui também.
 */
process.env.GUILD_NAME ??= 'Titan Inc';
process.env.GUILD_REALM ??= 'Azralon';
process.env.GUILD_OFFICER_RANK_MAX ??= '2';

describe('OfficersService', () => {
  const blizzard = { getGuildRosterSnapshot: jest.fn() };
  const repo = {
    findAll: jest.fn(),
    upsert: jest.fn(),
    findById: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    findKnownCharacters: jest.fn(),
  };
  const characters = { resolverDoRoster: jest.fn() };

  let service: OfficersService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findAll.mockResolvedValue([]);
    repo.findKnownCharacters.mockResolvedValue([]);
    repo.upsert.mockResolvedValue(dbGrant());
    repo.count.mockResolvedValue(5);
    characters.resolverDoRoster.mockResolvedValue('char-resolved');
    blizzard.getGuildRosterSnapshot.mockResolvedValue(
      snapshot([rosterMember('Fulano', 'azralon', 2)]),
    );

    service = new OfficersService(
      repo as unknown as OfficersRepository,
      blizzard as unknown as BlizzardService,
      characters as unknown as CharactersRepository,
    );
  });

  describe('grant', () => {
    it('resolve a identidade pela grafia da Blizzard, não a digitada', async () => {
      // O que a pessoa digitou casa por slug, mas quem resolve a identidade é
      // `resolverDoRoster` com a grafia do roster — é ela que o login grava em
      // `Character`, e as duas precisam casar depois.
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([rosterMember('Jocí', 'azralon', 4)]),
      );

      await service.grant({ name: 'joci', realm: 'Azralon' }, 'Chefe#1234');

      expect(characters.resolverDoRoster).toHaveBeenCalledWith({ name: 'Jocí', realm: 'azralon' });
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ characterId: 'char-resolved', grantedBy: 'Chefe#1234' }),
      );
    });

    it('recusa personagem que não está no roster', async () => {
      // O caso "Saths": nome que não existe vira grant que nunca casa, e o erro
      // só apareceria semanas depois como "não consigo entrar".
      await expect(
        service.grant({ name: 'inexistente', realm: 'Azralon' }, 'Chefe#1234'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('recusa quando o nome digitado casa com mais de uma grafia', async () => {
      // Três personagens diferentes colapsam no mesmo slug. Escolher um deles
      // sozinho daria acesso a dado pessoal para quem não foi escolhido.
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([
          rosterMember('Jocí', 'azralon', 4),
          rosterMember('Jocï', 'azralon', 7),
          rosterMember('Joci', 'azralon', 5),
        ]),
      );

      await expect(
        service.grant({ name: 'joci', realm: 'Azralon' }, 'Chefe#1234'),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('não confunde personagens de mesmo nome em realms diferentes', async () => {
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([rosterMember('Fulano', 'illidan', 2)]),
      );

      await expect(
        service.grant({ name: 'Fulano', realm: 'Azralon' }, 'Chefe#1234'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('recusa conceder quando o roster veio vazio', async () => {
      // Mesma lógica do abort da revalidação: sem roster confiável, a decisão
      // fica tomada em cima de nada.
      blizzard.getGuildRosterSnapshot.mockResolvedValue(snapshot([]));

      await expect(
        service.grant({ name: 'Fulano', realm: 'Azralon' }, 'Chefe#1234'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('revoke', () => {
    it('revoga quando há outros oficiais', async () => {
      repo.findById.mockResolvedValue(dbGrant());
      repo.count.mockResolvedValue(3);

      await service.revoke('grant-1', 'Chefe#1234');

      expect(repo.delete).toHaveBeenCalledWith('grant-1');
    });

    it('recusa revogar o último quando ninguém é oficial por rank', async () => {
      // Sem isto, um clique deixa a guilda sem ninguém que consiga abrir a tela
      // de oficiais — e o conserto vira INSERT manual no banco de produção.
      repo.findById.mockResolvedValue(dbGrant());
      repo.count.mockResolvedValue(1);
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([rosterMember('Fulano', 'azralon', 5)]),
      );

      await expect(service.revoke('grant-1', 'Chefe#1234')).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('revoga o último grant quando os ranks de oficial cobrem a lista', async () => {
      // Desde 10/08/2026 os ranks 0–2 promovem sozinhos, então apagar o último
      // grant não tranca ninguém para fora. Recusar aqui seria barrar uma
      // revogação legítima com uma mensagem que virou mentira.
      repo.findById.mockResolvedValue(dbGrant());
      repo.count.mockResolvedValue(1);
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([rosterMember('Chefe', 'azralon', 0)]),
      );

      await service.revoke('grant-1', 'Chefe#1234');

      expect(repo.delete).toHaveBeenCalledWith('grant-1');
    });

    it('recusa revogar o último quando o roster não respondeu', async () => {
      // "Não sei" não pode virar "pode revogar": o erro é irreversível pela
      // tela. Recusar custa um minuto; liberar custa um INSERT em produção.
      repo.findById.mockResolvedValue(dbGrant());
      repo.count.mockResolvedValue(1);
      blizzard.getGuildRosterSnapshot.mockRejectedValue(new Error('Blizzard fora do ar'));

      await expect(service.revoke('grant-1', 'Chefe#1234')).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('404 quando a concessão já não existe', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.revoke('sumiu', 'Chefe#1234')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list', () => {
    it('marca como vinculado o grant que casa com uma conta existente', async () => {
      repo.findAll.mockResolvedValue([
        dbGrant({
          id: 'g1',
          character: { id: 'char-fulano', nameKey: 'fulano', realmKey: 'azralon' },
        }),
        dbGrant({
          id: 'g2',
          character: {
            id: 'char-sicrano',
            nameKey: 'sicrano',
            realmKey: 'azralon',
            name: 'Sicrano',
          },
        }),
      ]);
      // "Conhecido" agora é por characterId — é ele que casa direto com o grant.
      repo.findKnownCharacters.mockResolvedValue([
        { characterId: 'char-fulano', nameKey: 'fulano', realmKey: 'azralon' },
      ]);

      const { grants } = await service.list();

      expect(grants.find((g) => g.id === 'g1')?.linked).toBe(true);
      // "nunca logou" tem que ser distinguível de "grant errado" na tela.
      expect(grants.find((g) => g.id === 'g2')?.linked).toBe(false);
    });

    it('mostra a lista mesmo com o roster fora do ar, sem rank', async () => {
      // Regra 6: falha de API externa degrada, não derruba a página.
      repo.findAll.mockResolvedValue([dbGrant()]);
      blizzard.getGuildRosterSnapshot.mockRejectedValue(new Error('Blizzard fora do ar'));

      const { grants, byRank, rosterOk } = await service.list();

      expect(grants).toHaveLength(1);
      expect(grants[0]?.rank).toBeNull();
      // Lacuna nunca vira zero — Regra 7. `byRank` vazio com rosterOk falso é
      // "não sei"; sem a flag a tela afirmaria "não há oficial automático".
      expect(byRank).toEqual([]);
      expect(rosterOk).toBe(false);
    });

    it('trata roster vazio como falha, não como guilda sem ninguém', async () => {
      // ~590 membros nunca devolvem zero de verdade; zero é a API falhando.
      blizzard.getGuildRosterSnapshot.mockResolvedValue(snapshot([]));

      expect((await service.list()).rosterOk).toBe(false);
    });

    it('traz o rank atual de quem está no roster', async () => {
      repo.findAll.mockResolvedValue([dbGrant()]);

      const { grants } = await service.list();

      expect(grants[0]?.rank).toBe(2);
    });

    it('lista os oficiais automáticos do corte para baixo, e só eles', async () => {
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([
          rosterMember('Chefe', 'azralon', 0),
          rosterMember('Oficial', 'azralon', 2),
          rosterMember('Raider', 'azralon', 4),
          rosterMember('Social', 'azralon', 7),
        ]),
      );

      const { byRank, officerRankMax } = await service.list();

      expect(officerRankMax).toBe(2);
      // Rank 4 é Raider: entra na área interna e NÃO vê candidatura. Se este
      // teste passar a incluir "Raider", o painel de recrutamento vazou.
      expect(byRank.map((o) => o.name)).toEqual(['Chefe', 'Oficial']);
    });

    it('ordena os automáticos por rank, do mais alto para o mais baixo', async () => {
      // A ordem em que a Blizzard devolve o roster não é estável; a tela não
      // pode reordenar sozinha entre duas requisições.
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([
          rosterMember('Dois', 'azralon', 2),
          rosterMember('Zero', 'azralon', 0),
          rosterMember('Um', 'azralon', 1),
        ]),
      );

      const { byRank } = await service.list();

      expect(byRank.map((o) => o.rank)).toEqual([0, 1, 2]);
    });

    it('marca o automático que ainda não logou no site', async () => {
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([rosterMember('Chefe', 'azralon', 0), rosterMember('Oficial', 'azralon', 1)]),
      );
      repo.findKnownCharacters.mockResolvedValue([
        { characterId: 'char-chefe', nameKey: 'chefe', realmKey: 'azralon' },
      ]);

      const { byRank } = await service.list();

      expect(byRank.find((o) => o.name === 'Chefe')?.linked).toBe(true);
      expect(byRank.find((o) => o.name === 'Oficial')?.linked).toBe(false);
    });
  });
});
