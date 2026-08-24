'use client';
import type { SessionUser } from '@titan/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL } from '../../lib/config';
import { CANAL_LOGIN, avisoLoginSchema } from '../../lib/auth/canal';
import { BotaoBattleNet } from './auth/botao-battlenet';
import { ModalErroLogin } from './auth/modal-erro-login';

/**
 * De quanto em quanto tempo a mãe pergunta se a sessão já nasceu.
 *
 * Rápido no começo, porque é quando quase todo login termina; lento depois,
 * porque a partir daí a pessoa está lidando com 2FA ou recuperação de senha e
 * mais um pedido por segundo não adianta nada.
 */
const INTERVALO_INICIAL_MS = 1000;
const INTERVALO_LENTO_MS = 5000;
const DESACELERA_APOS_MS = 2 * 60 * 1000;

/**
 * Desistência da janela mãe.
 *
 * Tem que ser folgado o bastante para não expirar **antes do backend**: o
 * cookie de OAuth dura 6h justamente para cobrir 2FA e senha esquecida, e uma
 * mãe que desiste em 3 minutos faz o login dar certo sem ninguém aproveitar —
 * a sessão nasce e a tela continua oferecendo o botão de entrar.
 *
 * Trinta minutos só morde quem deixou o popup aberto e foi embora. Quem fecha
 * a janela sai em segundos, pelo caminho do cancelamento.
 */
const LIMITE_MS = 30 * 60 * 1000;

/**
 * Carência entre ver o popup fechado e chamar de cancelamento.
 *
 * Fechar a janela é o último passo de um login que **deu certo**, então "fechou"
 * sozinho não distingue sucesso de desistência. A carência dá tempo de a
 * verificação de sessão responder antes de acusar cancelamento — era esse o
 * erro que aparecia em login bem-sucedido (TIT-144).
 */
const CARENCIA_FECHAMENTO_MS = 2500;

async function temSessao(): Promise<boolean> {
  try {
    const res = await fetch('/api/sessao', { cache: 'no-store' });
    if (!res.ok) return false;
    const corpo: unknown = await res.json();
    return (corpo as { autenticado?: boolean }).autenticado === true;
  } catch {
    return false;
  }
}

export function LoginButton({
  sessao,
  compacto = false,
}: {
  sessao: SessionUser | null;
  compacto?: boolean;
}) {
  const router = useRouter();
  const popup = useRef<Window | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const [aguardando, setAguardando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const abrir = useCallback(() => {
    if (popup.current && !popup.current.closed) {
      popup.current.focus();
      return;
    }
    const largura = Math.min(480, screen.availWidth);
    const altura = Math.min(720, screen.availHeight);
    popup.current = window.open(
      `${API_URL}/auth/battlenet?mode=popup`,
      'titan_oauth',
      `popup=yes,width=${largura},height=${altura},left=${screenX + (outerWidth - largura) / 2},top=${screenY + (outerHeight - altura) / 2},noopener=no`,
    );
    if (!popup.current) {
      setErro('bloqueado');
      return;
    }
    setErro(null);
    setAguardando(true);
  }, []);

  useEffect(() => {
    if (!aguardando) return;

    let vivo = true;
    let fechadoEm: number | null = null;

    function encerrar() {
      vivo = false;
      try {
        popup.current?.close();
      } catch {
        // Já fechado, ou recusado. Nada a fazer.
      }
      popup.current = null;
      setAguardando(false);
    }

    function concluir() {
      if (!vivo) return;
      encerrar();
      setErro(null);
      router.push('/interno');
      // A navbar é renderizada no servidor com a sessão; sem isto ela continua
      // mostrando "Acesse com a Battle.net" depois de entrar.
      router.refresh();
    }

    /**
     * A verificação que não depende de janela nenhuma.
     *
     * É ela que fecha o ciclo quando o canal não chega — popup morto cedo
     * demais, navegador sem BroadcastChannel, aba mãe em segundo plano.
     */
    const comecou = Date.now();
    let proxima = 0;

    async function verificar() {
      if (!vivo) return;

      if (await temSessao()) {
        concluir();
        return;
      }

      if (!vivo) return;

      // Popup fechado E sem sessão. Espera a carência antes de acusar: a
      // resposta acima pode estar a caminho.
      if (popup.current?.closed) {
        fechadoEm ??= Date.now();
        if (Date.now() - fechadoEm >= CARENCIA_FECHAMENTO_MS) {
          encerrar();
          setErro('cancelado');
          return;
        }
      } else {
        fechadoEm = null;
      }

      agendar();
    }

    // `setTimeout` que se reagenda, e não `setInterval`: o intervalo muda com o
    // tempo, e assim uma verificação lenta nunca se sobrepõe à seguinte.
    function agendar() {
      if (!vivo) return;
      const espera =
        Date.now() - comecou < DESACELERA_APOS_MS ? INTERVALO_INICIAL_MS : INTERVALO_LENTO_MS;
      proxima = window.setTimeout(() => void verificar(), espera);
    }

    agendar();

    const limite = window.setTimeout(() => {
      if (!vivo) return;
      encerrar();
      setErro('timeout');
    }, LIMITE_MS);

    /**
     * Caminho rápido. Não checa identidade de janela de propósito: o remetente
     * já pode ter sido descartado, e era essa comparação que descartava o aviso
     * de um login bem-sucedido. O canal é same-origin — quem consegue postar
     * nele já está rodando no nosso site.
     *
     * Mesmo assim, `status: 'ok'` não é acreditado de graça: confirma contra
     * `/api/sessao` antes de navegar. Assim o aviso só **adianta** o que a
     * verificação diria, nunca inventa uma sessão que não existe.
     */
    let canal: BroadcastChannel | null = null;
    try {
      canal = new BroadcastChannel(CANAL_LOGIN);
      canal.onmessage = (evento: MessageEvent) => {
        const dado = avisoLoginSchema.safeParse(evento.data);
        if (!dado.success || !vivo) return;

        if (dado.data.status === 'erro') {
          encerrar();
          setErro(dado.data.motivo ?? 'falha');
          return;
        }

        void (async () => {
          if (await temSessao()) concluir();
        })();
      };
    } catch {
      // Sem canal, o polling acima resolve — só demora até 1s a mais.
    }

    return () => {
      vivo = false;
      window.clearTimeout(proxima);
      window.clearTimeout(limite);
      canal?.close();
    };
  }, [aguardando, router]);

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
    <span>
      <BotaoBattleNet
        ref={botao}
        type="button"
        compacto={compacto}
        onClick={abrir}
        disabled={aguardando}
        aria-busy={aguardando}
        aria-label="Acesse com a Battle.net"
      >
        {aguardando ? 'Aguardando Battle.net…' : 'Acesse com a Battle.net'}
      </BotaoBattleNet>
      <span aria-live="polite" className="sr-only">
        {erro
          ? `Falha no login: ${erro}.`
          : aguardando
            ? 'Aguardando autorização da Battle.net.'
            : ''}
      </span>
      <ModalErroLogin
        motivo={erro}
        aoFechar={() => {
          setErro(null);
          botao.current?.focus();
        }}
        aoTentar={abrir}
      />
    </span>
  );
}
