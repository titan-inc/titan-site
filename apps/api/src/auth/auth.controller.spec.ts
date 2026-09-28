import type { Request, Response } from 'express';
import { AuthController, SESSION_COOKIE } from './auth.controller';
import type { AuthService } from './auth.service';

/**
 * O OAuth é sempre navegação de página inteira desde a TIT-148. Não há mais
 * `mode=popup`, cookie de modo, nem destino `/oauth/callback`.
 */
describe('AuthController OAuth por redirect', () => {
  const auth = {
    createOpaqueToken: jest.fn(() => 'state-token'),
    buildAuthorizeUrl: jest.fn(() => 'https://blizzard.test/authorize'),
    completeLogin: jest.fn(() => Promise.resolve({ sessionId: 'session-token' })),
    sessionCookieMaxAgeMs: 2592000000,
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

  describe('start', () => {
    it('grava o state e manda para o consent da Blizzard', () => {
      const { res, cookie, redirect } = response();
      controller.start(res);
      expect(cookie).toHaveBeenCalledWith('titan_oauth_state', 'state-token', {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 6 * 60 * 60 * 1000,
        path: '/',
      });
      expect(redirect).toHaveBeenCalledWith('https://blizzard.test/authorize');
    });

    // A janela do login tem que cobrir 2FA e recuperação de senha. Dez minutos
    // não cobria, e foi o que abriu a TIT-144.
    it('a janela do login é de 6 horas', () => {
      const { res, cookie } = response();
      controller.start(res);
      const [, , opcoes] = cookie.mock.calls[0] as [string, string, { maxAge: number }];
      expect(opcoes.maxAge).toBe(21600000);
    });

    it('guarda o destino quando ele é da área interna', () => {
      const { res, cookie } = response();
      controller.start(res, undefined, '/interno/loot/abc');
      expect(cookie).toHaveBeenCalledWith(
        'titan_oauth_destino',
        '/interno/loot/abc',
        expect.objectContaining({ httpOnly: true, path: '/' }),
      );
    });

    // Sem isto, um destino esquecido de uma tentativa abandonada decide para
    // onde vai um login posterior — e a janela de 6h torna isso provável.
    it('sem destino APAGA um destino antigo', () => {
      const { res, cookie, clearCookie } = response();
      controller.start(res);
      expect(cookie).toHaveBeenCalledTimes(1);
      expect(clearCookie).toHaveBeenCalledWith('titan_oauth_destino', { path: '/' });
    });

    it('destino de fora da área interna é recusado, não guardado', () => {
      const { res, cookie, clearCookie } = response();
      controller.start(res, undefined, '//evil.test/interno');
      expect(cookie).toHaveBeenCalledTimes(1);
      expect(clearCookie).toHaveBeenCalledWith('titan_oauth_destino', { path: '/' });
    });

    it('trocar=1 pede credenciais de novo à Blizzard', () => {
      const { res } = response();
      controller.start(res, '1');
      expect(auth.buildAuthorizeUrl).toHaveBeenCalledWith(
        'state-token',
        'http://api.test/auth/battlenet/callback',
        true,
      );
    });
  });

  describe('callback', () => {
    it('sucesso grava a sessão e cai em /interno', async () => {
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
        maxAge: auth.sessionCookieMaxAgeMs,
        path: '/',
      });
    });

    // O cookie do browser é só o portador; a validade real é a do banco. Se
    // este teste passar a comparar com o TTL da sessão, o deslizamento quebra:
    // o browser jogaria o cookie fora com a sessão ainda viva.
    it('o maxAge do cookie é o do portador, não o da sessão', async () => {
      const { res, cookie } = response();
      await controller.callback(
        'code',
        'state-token',
        undefined,
        request({ titan_oauth_state: 'state-token' }),
        res,
      );
      const chamadas = cookie.mock.calls as Array<[string, string, { maxAge: number }]>;
      const sessao = chamadas.find(([nome]) => nome === SESSION_COOKIE);
      expect(sessao?.[2].maxAge).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('devolve ao destino guardado', async () => {
      const { res, redirect } = response();
      await controller.callback(
        'code',
        'state-token',
        undefined,
        request({ titan_oauth_state: 'state-token', titan_oauth_destino: '/interno/loot/abc' }),
        res,
      );
      expect(redirect).toHaveBeenCalledWith('http://web.test/interno/loot/abc');
    });

    // Revalidado na volta, não só na ida: cookie adulterado entre as pontas não
    // pode virar redirect para fora do site.
    it('destino adulterado no cookie cai no padrão, não no host de fora', async () => {
      const { res, redirect } = response();
      await controller.callback(
        'code',
        'state-token',
        undefined,
        request({ titan_oauth_state: 'state-token', titan_oauth_destino: '//evil.test/' }),
        res,
      );
      expect(redirect).toHaveBeenCalledWith('http://web.test/interno');
    });

    it('state inválido não completa login', async () => {
      const { res, redirect } = response();
      await controller.callback(
        'code',
        'errado',
        undefined,
        request({ titan_oauth_state: 'state-token' }),
        res,
      );
      expect(redirect).toHaveBeenCalledWith('http://web.test/?erro=state');
      expect(auth.completeLogin).not.toHaveBeenCalled();
    });

    it('state ausente no cookie não completa login', async () => {
      const { res, redirect } = response();
      await controller.callback('code', 'state-token', undefined, request(), res);
      expect(redirect).toHaveBeenCalledWith('http://web.test/?erro=state');
      expect(auth.completeLogin).not.toHaveBeenCalled();
    });

    // A home é o único lugar de login, e é ela que abre o modal com o motivo.
    // Sem este teste, mandar para uma página `/entrar` que não existe mais
    // passaria despercebido e viraria 404 no caminho de erro.
    it('cancelamento volta para a home com o motivo', async () => {
      const { res, redirect } = response();
      await controller.callback(
        undefined,
        undefined,
        'access_denied',
        request({ titan_oauth_state: 'state-token' }),
        res,
      );
      expect(redirect).toHaveBeenCalledWith('http://web.test/?erro=cancelado');
    });

    it('falha ao concluir volta para a home sem gravar sessão', async () => {
      auth.completeLogin.mockRejectedValueOnce(new Error('Blizzard fora do ar'));
      const { res, cookie, redirect } = response();
      await controller.callback(
        'code',
        'state-token',
        undefined,
        request({ titan_oauth_state: 'state-token' }),
        res,
      );
      expect(redirect).toHaveBeenCalledWith('http://web.test/?erro=falha');
      expect(cookie).not.toHaveBeenCalledWith(SESSION_COOKIE, expect.anything(), expect.anything());
    });

    it('sempre limpa os cookies de OAuth, mesmo no erro', async () => {
      const { res, clearCookie } = response();
      await controller.callback(undefined, undefined, 'access_denied', request(), res);
      expect(clearCookie).toHaveBeenCalledWith('titan_oauth_state', { path: '/' });
      expect(clearCookie).toHaveBeenCalledWith('titan_oauth_destino', { path: '/' });
    });
  });
});
