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
import { DESTINO_PADRAO, destinoSeguro } from './destino-login';

export const SESSION_COOKIE = 'titan_session';
const STATE_COOKIE = 'titan_oauth_state';
const DESTINO_COOKIE = 'titan_oauth_destino';

/**
 * Quanto tempo o login tem para terminar, contado do clique no botão.
 *
 * Seis horas, e não dez minutos como até 24/08/2026 (TIT-144). Dez minutos não
 * cobria senha errada, 2FA no celular ou recuperação de senha.
 *
 * **Encurtar isto não era o que segurava o CSRF.** O `state` é `httpOnly`:
 * quem ataca não lê o valor, então não consegue casar com o `state` da
 * querystring. O que protege é a comparação, não o relógio.
 */
const OAUTH_COOKIE_TTL_MS = 6 * 60 * 60 * 1000;

/** Flags comuns aos cookies de OAuth. O TTL vai à parte, por clareza. */
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
   * Navegação de página inteira, sempre. O popup saiu na TIT-148 — ele exigia
   * `window.open`, `BroadcastChannel`, polling e uma carência para adivinhar se
   * a janela fechou por sucesso ou por desistência, e cada peça dessas era um
   * jeito de um login bem-sucedido não chegar na tela.
   *
   * `?trocar=1` força a Blizzard a pedir credenciais de novo. Necessário porque
   * nosso logout não encerra a sessão da Blizzard — sem isso, quem tem duas
   * contas Battle.net não consegue trocar: o authorize devolve a mesma conta
   * na hora, sem mostrar tela nenhuma.
   *
   * `?de=/interno/...` é para onde voltar depois. Guardado em cookie, e não
   * carregado no `state`, porque o `state` é comparado byte a byte no retorno e
   * misturar destino nele faria a validação de CSRF depender de formatação.
   */
  @Get('battlenet')
  start(@Res() res: Response, @Query('trocar') trocar?: string, @Query('de') de?: string): void {
    const state = this.auth.createOpaqueToken();
    const redirectUri = requireEnv('BLIZZARD_REDIRECT_URI');
    const forceLogin = trocar === '1';
    const destino = destinoSeguro(de);

    // O `state` protege o callback contra CSRF: guardamos em cookie e
    // comparamos no retorno. Sem isso, um terceiro poderia forjar um callback.
    res.cookie(STATE_COOKIE, state, { ...OAUTH_COOKIE, maxAge: OAUTH_COOKIE_TTL_MS });

    // Gravado OU apagado, nunca deixado como estava: um destino esquecido de
    // uma tentativa abandonada mandaria o login seguinte para a página errada,
    // e com janela de 6h isso é provável, não teórico.
    if (destino) {
      res.cookie(DESTINO_COOKIE, destino, { ...OAUTH_COOKIE, maxAge: OAUTH_COOKIE_TTL_MS });
    } else {
      res.clearCookie(DESTINO_COOKIE, { path: '/' });
    }

    // Sem isto, quem começa o login e não volta é invisível: só o sucesso
    // aparecia no log, então "não consigo entrar" não tinha onde ser conferido.
    // Nada de identificável — a pessoa ainda não se identificou.
    this.logger.log(
      `Login iniciado: destino=${destino ?? DESTINO_PADRAO}` +
        `${forceLogin ? ' trocar=1' : ''}${de && !destino ? ` (destino "${de}" recusado)` : ''}`,
    );

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
    const cookies = req.cookies as Record<string, string> | undefined;
    const expectedState = cookies?.[STATE_COOKIE];

    // Revalidado na volta, não só na ida: o cookie pode ter sido adulterado
    // entre as duas pontas, e confiar nele por já ter passado uma vez é
    // exatamente o erro que valida entrada uma vez só.
    const destino = destinoSeguro(cookies?.[DESTINO_COOKIE]) ?? DESTINO_PADRAO;

    res.clearCookie(STATE_COOKIE, { path: '/' });
    res.clearCookie(DESTINO_COOKIE, { path: '/' });

    // A pessoa pode simplesmente cancelar no consent. Não é erro do sistema.
    if (error) {
      this.logger.log(`Login cancelado ou recusado pela Blizzard: ${error}`);
      res.redirect(`${webUrl}/?erro=cancelado`);
      return;
    }

    if (!code || !state || !expectedState || state !== expectedState) {
      this.logger.warn(
        `Callback com state inválido ou ausente (code=${code ? 'sim' : 'não'}, ` +
          `state=${state ? 'sim' : 'não'}, cookie=${expectedState ? 'sim' : 'não'})`,
      );
      res.redirect(`${webUrl}/?erro=state`);
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
        maxAge: this.auth.sessionCookieMaxAgeMs,
        path: '/',
      });

      // O destino é interno para membro e não-membro: a própria página explica
      // o estado. Mandar não-membro para um 403 seco vira dúvida no Discord —
      // ver a discussão de três estados na TIT-20.
      res.redirect(`${webUrl}${destino}`);
    } catch (err) {
      this.logger.error(
        `Falha ao concluir login: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      res.redirect(`${webUrl}/?erro=falha`);
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
