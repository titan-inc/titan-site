import { Injectable } from '@nestjs/common';
import type { Character, GuildCharacter, Membership, Session, User } from '@prisma/client';
import { chaveDe } from '../characters/characters.repository';
import { PrismaService } from '../prisma/prisma.service';

/** Personagem da conta que está no roster, como o login acabou de ver. */
export interface MatchedCharacterInput {
  /** Nome e realm como a Blizzard exibe. As chaves saem daqui. */
  name: string;
  realmSlug: string;
  rank: number;
}

export interface UpsertUserInput {
  battlenetId: string;
  battletag: string;
  membership: Membership;
  /** Melhor rank (menor número) entre `characters`. Nulo quando a lista é vazia. */
  guildRank: number | null;
  characters: MatchedCharacterInput[];
}

/**
 * User com os personagens carregados, e cada um com a identidade junto.
 *
 * A identidade vem sempre no mesmo `include` porque auth precisa do nome e do
 * realm em toda leitura de sessão — sem ela, cada uso viraria uma consulta a
 * mais para descobrir quem é o personagem que o guard acabou de carregar.
 */
export type UserWithCharacters = User & {
  characters: Array<GuildCharacter & { character: Character }>;
};

/**
 * Único lugar do módulo auth que fala com o Prisma — ver Regra 3 do CLAUDE.md.
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava a conta e **substitui** a lista de personagens.
   *
   * Substitui em vez de mesclar porque o login acabou de ver a verdade
   * completa: com o token do usuário, `characters` é a lista inteira da conta
   * cruzada com o roster de agora. Mesclar deixaria para sempre um personagem
   * que a pessoa deletou ou transferiu de realm.
   *
   * Tudo numa transação: entre apagar e recriar, um crash deixaria a conta sem
   * personagem nenhum — estado que o job de revalidação lê como "não dá para
   * verificar" e que exigiria login manual para consertar.
   */
  async upsertUser(input: UpsertUserInput): Promise<UserWithCharacters> {
    const data = {
      battletag: input.battletag,
      membership: input.membership,
      guildRank: input.guildRank,
      verifiedAt: new Date(),
    };

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { battlenetId: input.battlenetId },
        // Não existe isOfficer para gravar: ser oficial mora em OfficerGrant e
        // é derivado na leitura da sessão. Login não concede nem revoga nada.
        create: { battlenetId: input.battlenetId, ...data },
        update: data,
      });

      await tx.guildCharacter.deleteMany({ where: { userId: user.id } });

      // A identidade é resolvida DO ROSTER: aqui a grafia é a da Blizzard, e é
      // ela que vence quando as fontes discordam.
      for (const personagem of input.characters) {
        const chave = chaveDe({ name: personagem.name, realm: personagem.realmSlug });

        const identidade = await tx.character.upsert({
          where: { nameKey_realmKey: chave },
          create: { ...chave, name: personagem.name, realm: personagem.realmSlug },
          update: { name: personagem.name, realm: personagem.realmSlug },
          select: { id: true },
        });

        await tx.guildCharacter.create({
          data: { userId: user.id, characterId: identidade.id, rank: personagem.rank },
        });
      }

      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { characters: { include: { character: true } } },
      });
    });
  }

  /**
   * Todos os grants de oficial.
   *
   * A tabela é minúscula por natureza — são as poucas pessoas da liderança —
   * então ler inteira e casar em memória sai mais barato que montar um `WHERE`
   * com N pares (realm, nome), e deixa a normalização da Regra 6 acontecer no
   * código, em `isOfficerByGrants()`, em vez de dentro do SQL.
   *
   * Auth lê esta tabela mesmo ela sendo do domínio `officers` porque ela É o
   * modelo de autorização, que auth resolve a cada sessão. Quem escreve nela é
   * só o módulo officers.
   */
  async findOfficerGrants(): Promise<string[]> {
    const grants = await this.prisma.officerGrant.findMany({ select: { characterId: true } });
    return grants.map((g) => g.characterId);
  }

  async createSession(id: string, userId: string, expiresAt: Date): Promise<Session> {
    return this.prisma.session.create({ data: { id, userId, expiresAt } });
  }

  async findSessionWithUser(id: string): Promise<(Session & { user: UserWithCharacters }) | null> {
    return this.prisma.session.findUnique({
      where: { id },
      include: { user: { include: { characters: { include: { character: true } } } } },
    });
  }

  /**
   * Empurra a validade da sessão para frente.
   *
   * `updateMany` e não `update`: a sessão pode ter sido apagada entre a leitura
   * e esta escrita — logout em outra aba, ou o job de revalidação revogando
   * membership. `update` lançaria por isso, e derrubar um request por causa de
   * uma renovação perdida seria trocar um efeito nenhum por um erro.
   */
  async touchSession(id: string, expiresAt: Date): Promise<void> {
    await this.prisma.session.updateMany({ where: { id }, data: { expiresAt } });
  }

  async deleteSession(id: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id } });
  }

  /** Remove sessões expiradas. Chamado oportunisticamente, não é job. */
  async deleteExpiredSessions(): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
