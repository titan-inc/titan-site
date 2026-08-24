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
 * Os três guards de sessão, do mais frouxo para o mais apertado.
 *
 * | guard          | exige                                    | quem passa            |
 * | -------------- | ---------------------------------------- | --------------------- |
 * | `RosterGuard`  | sessão + personagem no roster            | qualquer um na guilda |
 * | `MemberGuard`  | o acima + rank <= `GUILD_RANK_ACCESS_MAX`| o time de raid        |
 * | `OfficerGuard` | o acima + ser oficial                    | a liderança           |
 *
 * O nome mais simples **não** é o mais permissivo, e isso é armadilha: quem
 * quiser "só exigir que seja da guilda" quer `RosterGuard`, não `MemberGuard`.
 */

/**
 * Exige sessão válida e **pelo menos um personagem no roster** — nada de rank.
 *
 * É o estado do meio da Regra 4, "membro sem acesso": está na guilda há dois
 * anos, rank acima do corte, e até aqui não recebia nada do site. M+ é o
 * primeiro caso em que isso faz sentido — não é raid, e o corte de rank existe
 * para manter a ferramenta do time de raid legível, não para guardar segredo.
 *
 * Continua sendo segurança de verdade (Regra 5): o proxy do Next é UX, e sem
 * este guard qualquer pessoa chama a API com `curl`.
 */
@Injectable()
export class RosterGuard implements CanActivate {
  constructor(protected readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const sessionId = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];

    const user = await this.auth.resolveSession(sessionId);
    if (!user) throw new UnauthorizedException('Sem sessão válida');

    const sessionUser = await this.auth.toSessionUser(user);
    if (sessionUser.membership !== 'member') {
      throw new ForbiddenException('Sua conta não tem personagem no roster da guilda');
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
 * Exige tudo do RosterGuard **mais** rank dentro do corte.
 *
 * Herda de propósito: as duas checagens vivendo em lugares diferentes é como
 * uma delas seria esquecida.
 */
@Injectable()
export class MemberGuard extends RosterGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    // Mensagens distintas de propósito: "não achamos seu personagem" (lançada
    // pelo RosterGuard) e "seu rank não alcança" pedem ações opostas de quem
    // recebe. Mandar a primeira para um membro de longa data faz o site parecer
    // quebrado.
    await super.canActivate(context);

    const req = context.switchToHttp().getRequest<Request & { user: SessionUser }>();
    if (!req.user.hasInternalAccess) {
      throw new ForbiddenException('Seu rank na guilda não dá acesso à área interna');
    }

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
