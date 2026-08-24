import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Battletag de uma conta, pela chave de identidade do personagem — Regra 6. */
export interface BattletagLookup {
  nameKey: string;
  realmKey: string;
  battletag: string;
}

/**
 * Único lugar do módulo guild-roster que fala com o Prisma — Regra 3.
 */
@Injectable()
export class GuildRosterRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Battletag de quem já logou no site, entre os personagens conhecidos.
   *
   * Não recebe lista de chaves para filtrar: a tabela de identidades só cresce
   * com quem logou ou tem histórico gravado, então é pequena perto dos ~590 do
   * roster — trazer tudo e casar em memória é mais simples que montar um `OR`
   * com uma cláusula por personagem.
   */
  async findBattletags(): Promise<BattletagLookup[]> {
    const personagens = await this.prisma.character.findMany({
      where: { guildCharacter: { isNot: null } },
      select: {
        nameKey: true,
        realmKey: true,
        guildCharacter: { select: { user: { select: { battletag: true } } } },
      },
    });

    const encontrados: BattletagLookup[] = [];
    for (const p of personagens) {
      if (!p.guildCharacter) continue;
      encontrados.push({
        nameKey: p.nameKey,
        realmKey: p.realmKey,
        battletag: p.guildCharacter.user.battletag,
      });
    }
    return encontrados;
  }
}
