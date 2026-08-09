import { Injectable } from '@nestjs/common';
import type { OfficerGrant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateGrantInput {
  /** Identidade via toCharacterKey() — COM acento. Ver Regra 6. */
  nameKey: string;
  /** Realm via toSlug(). */
  realmSlug: string;
  /** Nome e realm como a Blizzard exibe. */
  name: string;
  realm: string;
  grantedBy: string;
}

/**
 * Único lugar do módulo officers que fala com o Prisma — Regra 3.
 */
@Injectable()
export class OfficersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Mais novo primeiro: a lista é curta e a leitura útil é "quem entrou agora". */
  async findAll(): Promise<OfficerGrant[]> {
    return this.prisma.officerGrant.findMany({ orderBy: { grantedAt: 'desc' } });
  }

  /**
   * Cria ou atualiza o grant do personagem.
   *
   * Upsert em vez de create para conceder duas vezes não virar erro 500 numa
   * tela onde a liderança pode facilmente reenviar o mesmo nome. O
   * `grantedBy`/`grantedAt` passa a ser o da última concessão, que é a
   * informação mais útil.
   */
  async upsert(input: CreateGrantInput): Promise<OfficerGrant> {
    const { nameKey, realmSlug, ...rest } = input;

    return this.prisma.officerGrant.upsert({
      where: { realmSlug_nameKey: { realmSlug, nameKey } },
      create: { nameKey, realmSlug, ...rest },
      update: { ...rest, grantedAt: new Date() },
    });
  }

  /** Null quando não existe — o controller traduz para 404. */
  async findById(id: string): Promise<OfficerGrant | null> {
    return this.prisma.officerGrant.findUnique({ where: { id } });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.officerGrant.delete({ where: { id } });
  }

  async count(): Promise<number> {
    return this.prisma.officerGrant.count();
  }

  /**
   * Personagens de contas que já logaram, para dizer quais grants estão
   * vinculados a alguém de verdade.
   *
   * Só o par de identidade: nome de exibição e rank vêm do roster, e battletag
   * é dado pessoal que não tem por que sair daqui.
   */
  async findKnownCharacterKeys(): Promise<Array<{ nameKey: string; realmSlug: string }>> {
    return this.prisma.guildCharacter.findMany({
      select: { nameKey: true, realmSlug: true },
      distinct: ['realmSlug', 'nameKey'],
    });
  }
}
