import { Controller, Get, UseGuards } from '@nestjs/common';
import type { GuildRosterResponse } from '@titan/shared';
import { OfficerGuard } from '../auth/session.guard';
import { GuildRosterService } from './guild-roster.service';

/**
 * Roster completo da guilda (~590) — diferente de `RosterController`, que é o
 * time de raid curado no WoWAudit.
 *
 * Só oficial: rank, nível e classe já estão abertos no Logs e no WoWAudit
 * (Regra 4), mas o battletag de quem logou é dado pessoal, e a lista inteira
 * junto vira uma ferramenta de contato — não é para qualquer membro.
 *
 * O teste não é "a aba esconde?" — é "chamado sem cookie de oficial devolve
 * 401/403?" (Regra 5).
 */
@Controller('internal/guild-roster')
export class GuildRosterController {
  constructor(private readonly guildRoster: GuildRosterService) {}

  @Get()
  @UseGuards(OfficerGuard)
  get(): Promise<GuildRosterResponse> {
    return this.guildRoster.get();
  }
}
