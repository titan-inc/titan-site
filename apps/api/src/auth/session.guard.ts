import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isActingOfficer, type SessionUser } from '@titan/shared';
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

    const sessionUser = await this.auth.toSessionUser(user);
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
    // A conta inteira, com TODOS os personagens no roster. O SessionUser só
    // carrega o representante, e "meu histórico" precisa dos N — quem raida em
    // dois chars tem que ver os dois. Ver Regra 4.
    (req as Request & { account?: typeof user }).account = user;
    return true;
  }
}

/**
 * Exige tudo do MemberGuard **mais** a flag de oficial.
 *
 * Protege hoje duas coisas diferentes — o histórico de outras pessoas (Regra 7)
 * e a própria lista de oficiais — então checa a precondição comum,
 * `isActingOfficer`, e não uma das permissões específicas. Um guard que
 * checasse `canSeeOthersHistory` para proteger a lista de oficiais passaria a
 * mentir no dia em que as duas divergissem, e o jeito de descobrir seria pelo
 * acesso indevido.
 *
 * Herda do MemberGuard de propósito: um guard de oficial que esquecesse de
 * checar membership seria um jeito silencioso de ex-oficial continuar lendo
 * dado pessoal.
 */
@Injectable()
export class OfficerGuard extends MemberGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);

    const req = context.switchToHttp().getRequest<Request & { user: SessionUser }>();
    if (!isActingOfficer(req.user)) {
      throw new ForbiddenException('Esta área é restrita a oficiais');
    }

    return true;
  }
}
