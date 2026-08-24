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
  // Sem popup, a falha volta para a home com o motivo na querystring: a home é
  // o único lugar de login desde que `/entrar` saiu, e ela abre o mesmo modal
  // do fluxo de popup. O sucesso continua indo direto para a área interna.
  if (!popup) return resultado === 'ok' ? `${webUrl}/interno` : `${webUrl}/?erro=${resultado}`;
  return resultado === 'ok'
    ? `${webUrl}/oauth/callback?status=ok`
    : `${webUrl}/oauth/callback?status=erro&motivo=${resultado}`;
}

/**
 * Quanto tempo o login tem para terminar, contado do clique no botão.
 *
 * Seis horas, e não dez minutos como até 24/08/2026 (TIT-144). Dez minutos não
 * cobria senha errada, 2FA no celular ou recuperação de senha — e quando os
 * dois cookies venciam juntos, o callback caía no ramo sem popup e carregava a
 * home dentro da janelinha.
 *
 * **Encurtar isto não era o que segurava o CSRF.** O `state` é `httpOnly`:
 * quem ataca não lê o valor, então não consegue casar com o `state` da
 * querystring. O que protege é a comparação, não o relógio.
 *
 * O preço é uma janela maior para um cookie de modo esquecido, e é por isso
 * que `start()` agora limpa o de modo quando o login não é por popup.
 */
const OAUTH_COOKIE_TTL_MS = 6 * 60 * 60 * 1000;

/** Flags comuns aos dois cookies de OAuth. O TTL vai à parte, por clareza. */
const OAUTH_COOKIE = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;

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
    res.cookie(STATE_COOKIE, state, { ...OAUTH_COOKIE, maxAge: OAUTH_COOKIE_TTL_MS });

    // O cookie de modo é gravado OU apagado, nunca deixado como estava. Só
    // gravar deixaria um `popup` velho decidir o destino de um login posterior
    // feito por página inteira — ver `OAUTH_COOKIE_TTL_MS`.
    if (mode === 'popup') {
      res.cookie(MODE_COOKIE, 'popup', { ...OAUTH_COOKIE, maxAge: OAUTH_COOKIE_TTL_MS });
    } else {
      res.clearCookie(MODE_COOKIE, { path: '/' });
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
