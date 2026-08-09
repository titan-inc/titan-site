import {
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { SessionUser } from '@titan/shared';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';

export const SESSION_COOKIE = 'titan_session';
const STATE_COOKIE = 'titan_oauth_state';
const MODE_COOKIE = 'titan_oauth_mode';

function destinoLogin(
  webUrl: string,
  popup: boolean,
  resultado: 'ok' | 'cancelado' | 'state' | 'falha',
): string {
  if (!popup)
    return resultado === 'ok' ? `${webUrl}/interno` : `${webUrl}/entrar?erro=${resultado}`;
  return resultado === 'ok'
    ? `${webUrl}/oauth/callback?status=ok`
    : `${webUrl}/oauth/callback?status=erro&motivo=${resultado}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} é obrigatória (ver .env.example)`);
  return value;
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly auth: AuthService) {}

  /**
   * Início do login: redireciona para o consent da Blizzard.
   *
   * `?trocar=1` força a Blizzard a pedir credenciais de novo. Necessário porque
   * nosso logout não encerra a sessão da Blizzard — sem isso, quem tem duas
   * contas Battle.net não consegue trocar: o authorize devolve a mesma conta
   * na hora, sem mostrar tela nenhuma.
   */
  @Get('battlenet')
  start(
    @Res() res: Response,
    @Query('trocar') trocar?: string,
    @Query('mode') mode?: string,
  ): void {
    const state = this.auth.createOpaqueToken();
    const redirectUri = requireEnv('BLIZZARD_REDIRECT_URI');
    const forceLogin = trocar === '1';

    // O `state` protege o callback contra CSRF: guardamos em cookie e
    // comparamos no retorno. Sem isso, um terceiro poderia forjar um callback.
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60 * 1000,
      path: '/',
    });
    if (mode === 'popup') {
      res.cookie(MODE_COOKIE, 'popup', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 10 * 60 * 1000,
        path: '/',
      });
    }

    res.redirect(this.auth.buildAuthorizeUrl(state, redirectUri, forceLogin));
  }

  /** Retorno da Blizzard. */
  @Get('battlenet/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const webUrl = requireEnv('WEB_URL');
    const expectedState = (req.cookies as Record<string, string> | undefined)?.[STATE_COOKIE];
    const popup = (req.cookies as Record<string, string> | undefined)?.[MODE_COOKIE] === 'popup';

    res.clearCookie(STATE_COOKIE, { path: '/' });
    res.clearCookie(MODE_COOKIE, { path: '/' });

    // A pessoa pode simplesmente cancelar no consent. Não é erro do sistema.
    if (error) {
      this.logger.log(`Login cancelado ou recusado pela Blizzard: ${error}`);
      res.redirect(destinoLogin(webUrl, popup, 'cancelado'));
      return;
    }

    if (!code || !state || !expectedState || state !== expectedState) {
      this.logger.warn('Callback com state inválido ou ausente');
      res.redirect(destinoLogin(webUrl, popup, 'state'));
      return;
    }

    try {
      const { sessionId } = await this.auth.completeLogin(
        code,
        requireEnv('BLIZZARD_REDIRECT_URI'),
      );

      res.cookie(SESSION_COOKIE, sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: this.auth.sessionTtlMs,
        path: '/',
      });

      // O destino é /interno para membro e não-membro: a própria página
      // explica o estado. Mandar não-membro para um 403 seco vira dúvida no
      // Discord — ver a discussão de três estados na TIT-20.
      res.redirect(destinoLogin(webUrl, popup, 'ok'));
    } catch (err) {
      this.logger.error(
        `Falha ao concluir login: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      res.redirect(destinoLogin(webUrl, popup, 'falha'));
    }
  }

  /** Usuário da sessão atual. */
  @Get('me')
  async me(@Req() req: Request): Promise<SessionUser> {
    const sessionId = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    const user = await this.auth.resolveSession(sessionId);

    if (!user) throw new UnauthorizedException('Sem sessão válida');

    return this.auth.toSessionUser(user);
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    const sessionId = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    await this.auth.logout(sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).send();
  }
}
