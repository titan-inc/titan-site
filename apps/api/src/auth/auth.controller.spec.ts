import type { Request, Response } from 'express';
import { AuthController, SESSION_COOKIE } from './auth.controller';
import type { AuthService } from './auth.service';

describe('AuthController popup OAuth', () => {
  const auth = {
    createOpaqueToken: jest.fn(() => 'state-token'),
    buildAuthorizeUrl: jest.fn(() => 'https://blizzard.test/authorize'),
    completeLogin: jest.fn(() => Promise.resolve({ sessionId: 'session-token' })),
    sessionTtlMs: 86400000,
  };
  let controller: AuthController;

  function response() {
    const cookie = jest.fn();
    const clearCookie = jest.fn();
    const redirect = jest.fn();
    return {
      res: { cookie, clearCookie, redirect } as unknown as Response,
      cookie,
      clearCookie,
      redirect,
    };
  }
  const request = (cookies: Record<string, string> = {}) => ({ cookies }) as Request;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BLIZZARD_REDIRECT_URI = 'http://api.test/auth/battlenet/callback';
    process.env.WEB_URL = 'http://web.test';
    controller = new AuthController(auth as unknown as AuthService);
  });

  it('start sem mode não grava o cookie de modo', () => {
    const { res, cookie } = response();
    controller.start(res);
    expect(cookie).toHaveBeenCalledTimes(1);
  });

  it('start em popup grava cookie com as mesmas flags do state', () => {
    const { res, cookie } = response();
    controller.start(res, undefined, 'popup');
    const options = {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 10 * 60 * 1000,
      path: '/',
    };
    expect(cookie).toHaveBeenNthCalledWith(1, 'titan_oauth_state', 'state-token', options);
    expect(cookie).toHaveBeenNthCalledWith(2, 'titan_oauth_mode', 'popup', options);
  });

  it('start ignora qualquer outro mode', () => {
    const { res, cookie } = response();
    controller.start(res, undefined, 'janela');
    expect(cookie).toHaveBeenCalledTimes(1);
  });

  it('sucesso padrão mantém /interno e grava a sessão', async () => {
    const { res, cookie, redirect } = response();
    await controller.callback(
      'code',
      'state-token',
      undefined,
      request({ titan_oauth_state: 'state-token' }),
      res,
    );
    expect(redirect).toHaveBeenCalledWith('http://web.test/interno');
    expect(cookie).toHaveBeenCalledWith(SESSION_COOKIE, 'session-token', {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: auth.sessionTtlMs,
      path: '/',
    });
  });

  it('sucesso popup termina na página de callback', async () => {
    const { res, redirect } = response();
    await controller.callback(
      'code',
      'state-token',
      undefined,
      request({ titan_oauth_state: 'state-token', titan_oauth_mode: 'popup' }),
      res,
    );
    expect(redirect).toHaveBeenCalledWith('http://web.test/oauth/callback?status=ok');
  });

  it('state inválido no popup não completa login', async () => {
    const { res, redirect } = response();
    await controller.callback(
      'code',
      'errado',
      undefined,
      request({ titan_oauth_state: 'state-token', titan_oauth_mode: 'popup' }),
      res,
    );
    expect(redirect).toHaveBeenCalledWith(
      'http://web.test/oauth/callback?status=erro&motivo=state',
    );
    expect(auth.completeLogin).not.toHaveBeenCalled();
  });
});
