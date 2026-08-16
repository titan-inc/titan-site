import { Injectable } from '@nestjs/common';
import type { Character, OfficerGrant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateGrantInput {
  /** Identidade já resolvida — quem resolve é o `CharactersRepository`. */
  characterId: string;
  grantedBy: string;
}

export type OfficerGrantWithCharacter = OfficerGrant & { character: Character };

/** Identidade de quem já logou, nos dois formatos que o módulo precisa. */
export interface KnownCharacter {
  characterId: string;
  nameKey: string;
  realmKey: string;
}

/**
 * Único lugar do módulo officers que fala com o Prisma — Regra 3.
 */
@Injectable()
export class OfficersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Mais novo primeiro: a lista é curta e a leitura útil é "quem entrou agora". */
  async findAll(): Promise<OfficerGrantWithCharacter[]> {
    return this.prisma.officerGrant.findMany({
      orderBy: { grantedAt: 'desc' },
      include: { character: true },
    });
  }

  /**
   * Cria ou atualiza o grant do personagem.
   *
   * Upsert em vez de create para conceder duas vezes não virar erro 500 numa
   * tela onde a liderança pode facilmente reenviar o mesmo nome. O
   * `grantedBy`/`grantedAt` passa a ser o da última concessão, que é a
   * informação mais útil.
   */
  async upsert(input: CreateGrantInput): Promise<OfficerGrantWithCharacter> {
    const { characterId, ...rest } = input;

    return this.prisma.officerGrant.upsert({
      where: { characterId },
      create: { characterId, ...rest },
      update: { ...rest, grantedAt: new Date() },
      include: { character: true },
    });
  }

  /** Null quando não existe — o controller traduz para 404. */
  async findById(id: string): Promise<OfficerGrantWithCharacter | null> {
    return this.prisma.officerGrant.findUnique({ where: { id }, include: { character: true } });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.officerGrant.delete({ where: { id } });
  }

  async count(): Promise<number> {
    return this.prisma.officerGrant.count();
  }

  /**
   * Identidades de contas que já logaram, para dizer quais grants — e quais
   * oficiais automáticos — estão vinculados a alguém de verdade.
   *
   * `GuildCharacter` só existe depois do primeiro login (Regra 4), então esta
   * lista É a definição de "conta real por trás". Vem nos dois formatos:
   * `characterId` para casar direto com um grant, `nameKey`/`realmKey` para
   * casar com um membro do roster vivo, que ainda não tem id nenhum.
   */
  async findKnownCharacters(): Promise<KnownCharacter[]> {
    const linhas = await this.prisma.guildCharacter.findMany({
      select: { characterId: true, character: { select: { nameKey: true, realmKey: true } } },
    });

    return linhas.map((l) => ({
      characterId: l.characterId,
      nameKey: l.character.nameKey,
      realmKey: l.character.realmKey,
    }));
  }
}
