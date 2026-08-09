import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { SESSION_COOKIE } from './auth.controller';

/**
 * Exige sessão válida, personagem no roster E rank dentro do corte.
 *
 * Este guard é a segurança de verdade — ver Regra 5 do CLAUDE.md. O proxy do
 * Next que protege /interno é só UX; sem este guard, qualquer pessoa chama a
 * API com `curl` e recebe os dados.
 */
@Injectable()
export class MemberGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const sessionId = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];

    const user = await this.auth.resolveSession(sessionId);
    if (!user) throw new UnauthorizedException('Sem sessão válida');

    const sessionUser = this.auth.toSessionUser(user);
    if (!sessionUser.hasInternalAccess) {
      // Duas mensagens distintas de propósito: "não achamos seu personagem" e
      // "seu rank não alcança" pedem ações opostas de quem recebe. Mandar a
      // primeira para um membro de longa data faz o site parecer quebrado.
      throw new ForbiddenException(
        sessionUser.membership === 'member'
          ? 'Seu rank na guilda não dá acesso à área interna'
          : 'Sua conta não tem personagem no roster da guilda',
      );
    }

    // Disponível para os controllers via req.user.
    (req as Request & { user?: typeof sessionUser }).user = sessionUser;
    return true;
  }
}
