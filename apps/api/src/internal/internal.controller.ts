import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { type SessionUser } from '@titan/shared';
import type { Request } from 'express';
import { MemberGuard } from '../auth/session.guard';

interface InternalSummary {
  greeting: string;
  membership: SessionUser['membership'];
  matchedCharacter: SessionUser['matchedCharacter'];
  guildRank: number | null;
}

/**
 * Área interna. Todo endpoint aqui é protegido por MemberGuard.
 *
 * Placeholder deliberado: as funcionalidades reais de guild management ainda não
 * foram definidas (TIT-21). Existe para provar o gate de ponta a ponta.
 */
@Controller('internal')
@UseGuards(MemberGuard)
export class InternalController {
  @Get('summary')
  summary(@Req() req: Request): InternalSummary {
    // Populado pelo MemberGuard.
    const user = (req as Request & { user: SessionUser }).user;

    return {
      greeting: `Bem-vindo, ${user.matchedCharacter?.name ?? user.battletag}`,
      membership: user.membership,
      matchedCharacter: user.matchedCharacter,
      guildRank: user.guildRank,
    };
  }
}
