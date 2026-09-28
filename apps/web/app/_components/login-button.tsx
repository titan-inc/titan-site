import type { SessionUser } from '@titan/shared';
import { API_URL } from '../../lib/config';
import { LinkBattleNet } from './auth/link-battlenet';

/**
 * Entrada da área de membros: link para a área interna, ou para o OAuth.
 *
 * **É um link, e essa é a decisão inteira** (TIT-148). Até 01/09/2026 isto era
 * um client component com `window.open`, `BroadcastChannel`, polling em
 * `/api/sessao`, carência de 2,5s para adivinhar se a janela fechou por sucesso
 * ou por desistência, e limite de 30 minutos — cinco peças coordenando o fim de
 * um login, cada uma capaz de fazer um login que deu certo não chegar na tela.
 *
 * Foi o que aconteceu: `/api/sessao` caía na regra genérica de `/api/*` do
 * Caddy e ia parar no Nest, que respondia 404, então o polling nunca funcionou
 * em produção. Sobrava o `BroadcastChannel`, e quando ele não chegava a janela
 * mãe acusava `cancelado` num login bem-sucedido.
 *
 * Redirect de página inteira não tem nenhum desses estados: a resposta do
 * callback já traz o cookie e já aponta para o destino. Some junto o que só
 * existia por causa do popup — bloqueio de popup, throttle de timer em aba de
 * segundo plano no celular e `window.closed` ambíguo.
 *
 * Sem hooks de propósito: assim funciona igual em Server e Client Component, e
 * continua sendo um `<a>` de verdade para quem navega sem JavaScript.
 */
export function LoginButton({
  sessao,
  compacto = false,
}: {
  sessao: SessionUser | null;
  compacto?: boolean;
}) {
  if (sessao)
    return (
      <a
        href="/interno"
        className="text-fg-muted hover:text-fg inline-flex min-h-11 items-center px-2 font-mono text-[11px] tracking-[0.14em] uppercase"
      >
        {compacto ? '↗' : 'Área de membros'}
      </a>
    );

  return (
    <LinkBattleNet
      href={`${API_URL}/auth/battlenet`}
      compacto={compacto}
      aria-label="Acesse com a Battle.net"
    >
      Acesse com a Battle.net
    </LinkBattleNet>
  );
}
