import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { TitanBetRepository } from './titan-bet.repository';

/**
 * A porta das rotas de uma rodada do Titan Bet: o `RosterGuard`, mais quem
 * **tem slip nesta rodada** (D-53a).
 *
 * Quem estava no snapshot de bettors e saiu da guilda depois continua
 * concorrendo (D-65) e mantém acesso à própria rodada e à própria aposta — só
 * àquela rodada, sem membership no resto do site. A revalidação apaga o
 * `GuildCharacter` e a conta vira `not_member`; o slip fica, e é por ele que a
 * conta é reconhecida. Outra rodada, ou qualquer outra área, continua 403.
 *
 * Na rota sem `:roundId` — a lista de rodadas —, basta slip em **alguma**
 * rodada; a lista que o service devolve é que se restringe às dele.
 *
 * Membro da guilda passa sem o banco ser consultado, como no `RosterGuard`.
 * Continua sendo segurança de verdade (Regra 5): sem sessão, 401.
 */
@Injectable()
export class ApostadorDaRodadaGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: TitanBetRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const sessionId = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];

    const user = await this.auth.resolveSession(sessionId);
    if (!user) throw new UnauthorizedException('Sem sessão válida');

    const sessionUser = await this.auth.toSessionUser(user);
    if (sessionUser.membership !== 'member') {
      const roundId = (req.params as Record<string, string | undefined>).roundId;
      const temSlip =
        roundId !== undefined
          ? await this.repo.contaTemSlipNaRodada(roundId, user.id)
          : await this.repo.contaTemAlgumSlip(user.id);
      if (!temSlip) {
        throw new ForbiddenException('Sua conta não tem personagem no roster da guilda');
      }
    }

    // Os mesmos campos do RosterGuard: os controllers leem a conta daqui.
    (req as Request & { user?: typeof sessionUser }).user = sessionUser;
    (req as Request & { account?: typeof user }).account = user;
    return true;
  }
}
