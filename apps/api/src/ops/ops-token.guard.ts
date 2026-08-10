import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

const TOKEN_HEADER = 'x-ops-token';

/**
 * Autoriza automação/CLI (não pessoa) — as rotas /internal/ops/* disparam
 * operações contra APIs externas e o banco fora do fluxo normal de sessão.
 *
 * Não reaproveita MemberGuard/OfficerGuard de propósito: aqueles exigem
 * cookie de sessão do Battle.net, e não faz sentido pedir login de guilda
 * pra um script rodar via `docker compose exec` ou um curl por túnel SSH.
 * É um ator diferente do modelo de permissão da Regra 4 (as ~3 pessoas que
 * operam o deploy, não membro nem oficial) — merece guard próprio, não uma
 * adaptação forçada dos guards de sessão.
 *
 * Também não é a única defesa: o Caddyfile bloqueia /api/internal/ops/* no
 * domínio público (ver TIT-109), então em condições normais esta rota nem
 * é alcançável de fora. O token é a segunda camada, pro caso de o bloqueio
 * do Caddy falhar ou mudar sem ninguém perceber.
 */
@Injectable()
export class OpsTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const recebido = req.header(TOKEN_HEADER);
    const esperado = process.env.OPS_TRIGGER_TOKEN;

    if (!esperado) {
      // Sem token configurado, a rota fica travada por padrão — nunca
      // "aberta por engano" só porque ninguém setou a variável ainda.
      throw new UnauthorizedException('OPS_TRIGGER_TOKEN não configurado');
    }

    if (!recebido || !tokensIguais(recebido, esperado)) {
      throw new UnauthorizedException('Token de ops inválido ou ausente');
    }

    return true;
  }
}

/**
 * Comparação em tempo constante — `===` vaza quanto do prefixo bateu através
 * do tempo de resposta, e não custa nada trocar por uma versão segura.
 */
function tokensIguais(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
