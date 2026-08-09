'use client';
import type { SessionUser } from '@titan/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { API_URL } from '../../lib/config';
import { BotaoBattleNet } from './auth/botao-battlenet';
import { ModalErroLogin } from './auth/modal-erro-login';

const mensagemOAuthSchema = z.object({
  tipo: z.literal('titan-oauth'),
  status: z.enum(['ok', 'erro']),
  motivo: z.string().optional(),
});

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
    setAguardando(true);
  }, []);

  useEffect(() => {
    if (!aguardando) return;
    const intervalo = window.setInterval(() => {
      if (popup.current?.closed) {
        popup.current = null;
        setAguardando(false);
        setErro('cancelado');
      }
    }, 500);
    const timeout = window.setTimeout(() => {
      popup.current?.close();
      popup.current = null;
      setAguardando(false);
      setErro('timeout');
    }, 180000);
    function mensagem(evento: MessageEvent) {
      if (evento.origin !== window.location.origin || evento.source !== popup.current) return;
      const dado = mensagemOAuthSchema.safeParse(evento.data);
      if (!dado.success) return;
      popup.current?.close();
      popup.current = null;
      setAguardando(false);
      if (dado.data.status === 'ok') router.push('/interno');
      else setErro(dado.data.motivo ?? 'falha');
    }
    window.addEventListener('message', mensagem);
    return () => {
      window.clearInterval(intervalo);
      window.clearTimeout(timeout);
      window.removeEventListener('message', mensagem);
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
