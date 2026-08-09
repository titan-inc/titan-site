'use client';
import type { SessionUser } from '@titan/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { API_URL, OAUTH_POPUP_HABILITADO } from '../../lib/config';
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
  const [estado, setEstado] = useState<
    'ocioso' | 'aguardando' | 'bloqueado' | 'cancelado' | 'timeout'
  >('ocioso');
  useEffect(() => {
    if (estado !== 'aguardando') return;
    const intervalo = window.setInterval(() => {
      if (popup.current?.closed) {
        popup.current = null;
        setEstado('cancelado');
      }
    }, 500);
    const timeout = window.setTimeout(() => {
      popup.current?.close();
      popup.current = null;
      setEstado('timeout');
    }, 180000);
    function mensagem(evento: MessageEvent) {
      if (evento.origin !== window.location.origin || evento.source !== popup.current) return;
      const dado = mensagemOAuthSchema.safeParse(evento.data);
      if (!dado.success) return;
      window.clearInterval(intervalo);
      window.clearTimeout(timeout);
      popup.current?.close();
      popup.current = null;
      setEstado('ocioso');
      router.refresh();
    }
    window.addEventListener('message', mensagem);
    return () => {
      window.clearInterval(intervalo);
      window.clearTimeout(timeout);
      window.removeEventListener('message', mensagem);
    };
  }, [estado, router]);
  if (sessao)
    return (
      <a
        href="/interno"
        className="text-fg-muted hover:text-fg inline-flex min-h-11 items-center px-2 font-mono text-[11px] tracking-[0.14em] uppercase"
      >
        {compacto ? '↗' : 'Área de membros'}
      </a>
    );
  if (!OAUTH_POPUP_HABILITADO)
    return (
      <span>
        <a
          href="/entrar"
          aria-label="Entrar; popup aguardando backend"
          className="text-fg-muted hover:text-fg inline-flex min-h-11 items-center px-2 font-mono text-[11px] tracking-[0.14em] uppercase"
        >
          {compacto ? '↗' : 'Entrar'}
        </a>
        <span role="note" className="sr-only">
          Login em popup aguardando suporte do backend.
        </span>
      </span>
    );
  function abrir() {
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
      setEstado('bloqueado');
      return;
    }
    setEstado('aguardando');
  }
  return (
    <span>
      <button
        type="button"
        onClick={abrir}
        disabled={estado === 'aguardando'}
        aria-busy={estado === 'aguardando'}
        className="text-fg-muted hover:text-fg inline-flex min-h-11 items-center px-2 font-mono text-[11px] tracking-[0.14em] uppercase disabled:opacity-60"
      >
        {estado === 'aguardando' ? 'Aguardando Battle.net…' : compacto ? '↗' : 'Entrar'}
      </button>
      <span aria-live="polite" className="sr-only">
        {estado === 'bloqueado'
          ? 'Seu navegador bloqueou a janela de login.'
          : estado === 'cancelado'
            ? 'Login cancelado.'
            : estado === 'timeout'
              ? 'O login demorou demais. Tente de novo.'
              : ''}
      </span>
      {estado === 'bloqueado' && (
        <a href={`${API_URL}/auth/battlenet`} className="text-danger text-xs underline">
          Entrar por página inteira
        </a>
      )}
    </span>
  );
}
