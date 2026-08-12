import { ForbiddenException, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { SessionUser } from '@titan/shared';
import type { AuthService } from './auth.service';
import { MemberGuard, OfficerGuard, RosterGuard } from './session.guard';

const RAIDER = 4;
const SOCIAL = 5;

function sessionUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    battletag: 'Fulano#1234',
    membership: 'member',
    isOfficer: false,
    guildRank: SOCIAL,
    hasInternalAccess: false,
    matchedCharacter: null,
    characterCount: 1,
    verifiedAt: null,
    ...overrides,
  };
}

/** Contexto com o cookie que o guard lê, ou sem cookie nenhum. */
function contexto(comCookie: boolean): { ctx: ExecutionContext; req: Record<string, unknown> } {
  const req: Record<string, unknown> = { cookies: comCookie ? { titan_session: 'sid' } : {} };
  return {
    ctx: { switchToHttp: () => ({ getRequest: () => req }) } as ExecutionContext,
    req,
  };
}

function authFake(user: SessionUser | null) {
  return {
    resolveSession: jest.fn().mockResolvedValue(user === null ? null : { id: 'u1' }),
    toSessionUser: jest.fn().mockResolvedValue(user),
  } as unknown as AuthService;
}

describe('RosterGuard', () => {
  it('sem cookie devolve 401 — Regra 5', async () => {
    const { ctx } = contexto(false);
    await expect(new RosterGuard(authFake(null)).canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('deixa passar membro de rank ACIMA do corte — que é o ponto', async () => {
    const user = sessionUser({ guildRank: SOCIAL, hasInternalAccess: false });
    const { ctx, req } = contexto(true);

    await expect(new RosterGuard(authFake(user)).canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toBe(user);
    expect(req.account).toEqual({ id: 'u1' });
  });

  it('recusa conta sem personagem no roster', async () => {
    const user = sessionUser({ membership: 'not-member', guildRank: null });
    const { ctx } = contexto(true);

    await expect(new RosterGuard(authFake(user)).canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('MemberGuard', () => {
  it('continua exigindo o corte de rank', async () => {
    const { ctx } = contexto(true);
    const fora = sessionUser({ guildRank: SOCIAL, hasInternalAccess: false });

    await expect(new MemberGuard(authFake(fora)).canActivate(ctx)).rejects.toThrow(
      /rank na guilda/,
    );

    const dentro = sessionUser({ guildRank: RAIDER, hasInternalAccess: true });
    await expect(new MemberGuard(authFake(dentro)).canActivate(contexto(true).ctx)).resolves.toBe(
      true,
    );
  });

  it('distingue "sem personagem" de "rank não alcança"', async () => {
    const semPersonagem = sessionUser({ membership: 'not-member', guildRank: null });
    await expect(
      new MemberGuard(authFake(semPersonagem)).canActivate(contexto(true).ctx),
    ).rejects.toThrow(/personagem no roster/);
  });
});

describe('OfficerGuard', () => {
  it('exige oficial além do corte de rank', async () => {
    const membro = sessionUser({ guildRank: RAIDER, hasInternalAccess: true, isOfficer: false });
    await expect(
      new OfficerGuard(authFake(membro)).canActivate(contexto(true).ctx),
    ).rejects.toThrow(/oficiais/);

    const oficial = sessionUser({ guildRank: 1, hasInternalAccess: true, isOfficer: true });
    await expect(new OfficerGuard(authFake(oficial)).canActivate(contexto(true).ctx)).resolves.toBe(
      true,
    );
  });
});
