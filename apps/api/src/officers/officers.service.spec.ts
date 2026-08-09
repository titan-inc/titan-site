import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { OfficerGrant } from '@prisma/client';
import type { BlizzardService, RosterMember, RosterSnapshot } from '../blizzard/blizzard.service';
import type { OfficersRepository } from './officers.repository';
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

const dbGrant = (over: Partial<OfficerGrant> = {}): OfficerGrant => ({
  id: 'grant-1',
  nameKey: 'fulano',
  realmSlug: 'azralon',
  name: 'Fulano',
  realm: 'azralon',
  grantedBy: 'Chefe#1234',
  grantedAt: new Date('2026-08-09T12:00:00Z'),
  ...over,
});

describe('OfficersService', () => {
  const blizzard = { getGuildRosterSnapshot: jest.fn() };
  const repo = {
    findAll: jest.fn(),
    upsert: jest.fn(),
    findById: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    findKnownCharacterKeys: jest.fn(),
  };

  let service: OfficersService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findAll.mockResolvedValue([]);
    repo.findKnownCharacterKeys.mockResolvedValue([]);
    repo.upsert.mockResolvedValue(dbGrant());
    repo.count.mockResolvedValue(5);
    blizzard.getGuildRosterSnapshot.mockResolvedValue(
      snapshot([rosterMember('Fulano', 'azralon', 2)]),
    );

    service = new OfficersService(
      repo as unknown as OfficersRepository,
      blizzard as unknown as BlizzardService,
    );
  });

  describe('grant', () => {
    it('grava a grafia da Blizzard, não a digitada', async () => {
      // O que a pessoa digitou casa por slug, mas o que vai para o banco tem
      // que ser o nameKey da Blizzard — é ele que o login grava em
      // GuildCharacter, e os dois precisam casar depois.
      blizzard.getGuildRosterSnapshot.mockResolvedValue(
        snapshot([rosterMember('Jocí', 'azralon', 4)]),
      );

      await service.grant({ name: 'joci', realm: 'Azralon' }, 'Chefe#1234');

      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ nameKey: 'jocí', name: 'Jocí', realmSlug: 'azralon' }),
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

    it('recusa revogar o último oficial', async () => {
      // Sem isto, um clique deixa a guilda sem ninguém que consiga abrir a tela
      // de oficiais — e o conserto vira INSERT manual no banco de produção.
      repo.findById.mockResolvedValue(dbGrant());
      repo.count.mockResolvedValue(1);

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
        dbGrant({ id: 'g1', nameKey: 'fulano', realmSlug: 'azralon' }),
        dbGrant({ id: 'g2', nameKey: 'sicrano', realmSlug: 'azralon', name: 'Sicrano' }),
      ]);
      repo.findKnownCharacterKeys.mockResolvedValue([{ nameKey: 'fulano', realmSlug: 'azralon' }]);

      const { grants } = await service.list();

      expect(grants.find((g) => g.id === 'g1')?.linked).toBe(true);
      // "nunca logou" tem que ser distinguível de "grant errado" na tela.
      expect(grants.find((g) => g.id === 'g2')?.linked).toBe(false);
    });

    it('mostra a lista mesmo com o roster fora do ar, sem rank', async () => {
      // Regra 6: falha de API externa degrada, não derruba a página.
      repo.findAll.mockResolvedValue([dbGrant()]);
      blizzard.getGuildRosterSnapshot.mockRejectedValue(new Error('Blizzard fora do ar'));

      const { grants } = await service.list();

      expect(grants).toHaveLength(1);
      expect(grants[0]?.rank).toBeNull();
    });

    it('traz o rank atual de quem está no roster', async () => {
      repo.findAll.mockResolvedValue([dbGrant()]);

      const { grants } = await service.list();

      expect(grants[0]?.rank).toBe(2);
    });
  });
});
