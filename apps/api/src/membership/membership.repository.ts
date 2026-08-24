import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Personagem, como o job precisa dele para conferir contra o roster. */
export interface CharacterToRevalidate {
  id: string;
  /** As chaves da Regra 6, agora vindas da identidade. */
  nameKey: string;
  realmKey: string;
  rank: number;
}

/** O que o job precisa saber de cada membro. Nada de battletag: não é usado aqui. */
export interface MemberToRevalidate {
  id: string;
  guildRank: number | null;
  characters: CharacterToRevalidate[];
}

/**
 * Único lugar do módulo membership que fala com o Prisma — ver Regra 3 do CLAUDE.md.
 */
@Injectable()
export class MembershipRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Todo mundo que hoje tem personagem no roster, com os personagens junto. */
  async findMembers(): Promise<MemberToRevalidate[]> {
    const membros = await this.prisma.user.findMany({
      where: { membership: 'member' },
      select: {
        id: true,
        guildRank: true,
        characters: {
          select: {
            id: true,
            rank: true,
            character: { select: { nameKey: true, realmKey: true } },
          },
        },
      },
    });

    return membros.map((m) => ({
      ...m,
      characters: m.characters.map((c) => ({
        id: c.id,
        nameKey: c.character.nameKey,
        realmKey: c.character.realmKey,
        rank: c.rank,
      })),
    }));
  }

  /**
   * Tira a membership e derruba as sessões, numa transação só.
   *
   * Os dois passos juntos porque separados abrem uma janela: entre marcar
   * not_member e apagar a sessão, um crash deixaria o ex-membro dentro com uma
   * sessão válida que nenhuma rodada futura iria olhar de novo — o job só varre
   * quem ainda é `member`.
   *
   * Apagar a sessão é o que corta o acesso na hora. É exatamente para isso que
   * a sessão tem estado no banco em vez de ser JWT.
   *
   * @returns quantas sessões foram apagadas
   */
  async revokeMembership(userIds: string[]): Promise<number> {
    if (userIds.length === 0) return 0;

    const [, sessions] = await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { id: { in: userIds } },
        data: {
          membership: 'not_member',
          // O rank vira nulo junto: manter o último rank faria a área pública
          // exibir "rank 3" para quem não está mais na guilda.
          guildRank: null,
          verifiedAt: new Date(),
        },
      }),
      this.prisma.session.deleteMany({ where: { userId: { in: userIds } } }),
    ]);

    return sessions.count;
  }

  /**
   * Remove personagens que saíram da guilda.
   *
   * Só o personagem sai — a conta continua membro se ainda tiver outro no
   * roster. É essa distinção que evita revogar acesso de quem tirou um alt.
   */
  async deleteCharacters(characterIds: string[]): Promise<number> {
    if (characterIds.length === 0) return 0;

    const result = await this.prisma.guildCharacter.deleteMany({
      where: { id: { in: characterIds } },
    });
    return result.count;
  }

  /** Promoção/rebaixamento de um personagem específico refletido no site. */
  async updateCharacterRank(characterId: string, rank: number): Promise<void> {
    await this.prisma.guildCharacter.update({ where: { id: characterId }, data: { rank } });
  }

  /** Novo melhor rank da conta, depois de olhar todos os personagens dela. */
  async updateRank(userId: string, guildRank: number): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { guildRank, verifiedAt: new Date() },
    });
  }

  /** Marca "conferido agora" para quem continua igual. */
  async touchVerified(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { verifiedAt: new Date() },
    });
  }
}
