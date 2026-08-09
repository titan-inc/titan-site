import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { canReviewApplications, type SessionUser } from '@titan/shared';
import type { Request } from 'express';
import { MemberGuard } from '../auth/session.guard';

interface InternalSummary {
  greeting: string;
  membership: SessionUser['membership'];
  matchedCharacter: SessionUser['matchedCharacter'];
  guildRank: number | null;
  canReviewApplications: boolean;
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
      // Ainda não há painel de candidaturas; o campo mostra o que a permissão
      // permitiria. Ver TIT-23.
      //
      // Pela função do shared, não por `user.isOfficer` cru: hoje o endpoint
      // está sob MemberGuard e os dois dariam o mesmo resultado, mas ler a flag
      // direto perde a exigência de membership no dia em que o guard mudar.
      canReviewApplications: canReviewApplications(user),
    };
  }
}
