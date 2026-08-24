import { Injectable } from '@nestjs/common';
import type { GuildRosterResponse } from '@titan/shared';
import { BlizzardService } from '../blizzard/blizzard.service';
import { chaveDe, indice } from '../characters/characters.repository';
import { GuildRosterRepository } from './guild-roster.repository';

/**
 * O roster inteiro da guilda (~590), para a aba de oficial em `/interno/roster`.
 *
 * Não confundir com `RosterService`, que serve o time de raid curado no
 * WoWAudit. Este lê direto da Blizzard (cache de 6h já existente em
 * `BlizzardService`) e não persiste nada — é só uma foto do agora, sem
 * histórico a construir.
 */
@Injectable()
export class GuildRosterService {
  constructor(
    private readonly blizzard: BlizzardService,
    private readonly repo: GuildRosterRepository,
  ) {}

  async get(): Promise<GuildRosterResponse> {
    const [roster, battletags] = await Promise.all([
      this.blizzard.getGuildRosterSnapshot(),
      this.repo.findBattletags(),
    ]);

    // Mesma chave de identidade da Regra 6 que o resto do sistema usa para
    // casar personagem do roster com `Character` gravado.
    const battletagPorChave = new Map(
      battletags.map((b) => [indice({ nameKey: b.nameKey, realmKey: b.realmKey }), b.battletag]),
    );

    const members = roster.members.map((m) => {
      const chave = chaveDe({ name: m.name, realm: m.realmSlug });
      return {
        name: m.name,
        realm: m.realm,
        level: m.level,
        wowClass: m.wowClass,
        rank: m.rank,
        // Nulo é o caso comum: a maioria da guilda nunca logou no site, e a
        // Blizzard não expõe battletag de conta alheia.
        battletag: battletagPorChave.get(indice(chave)) ?? null,
      };
    });

    return { members, fetchedAt: new Date(roster.fetchedAt).toISOString() };
  }
}
