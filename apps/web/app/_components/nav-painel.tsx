'use client';

import { useEffect, useRef } from 'react';
import type { ResumoProgressaoNav } from '../../lib/progressao/resumo-nav';
import { ProgressaoPainel } from './nav/progressao-nav';

const LINKS = [
  ['#sobre', 'Sobre'],
  ['#tripulacao', 'Tripulação'],
  ['#candidatura', 'Candidatura'],
] as const;

interface NavPainelProps {
  aberto: boolean;
  aoFechar: () => void;
  gatilho: React.RefObject<HTMLButtonElement | null>;
  progressao: ResumoProgressaoNav | null;
}

export function NavPainel({ aberto, aoFechar, gatilho, progressao }: NavPainelProps) {
  const painel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const raiz = document.documentElement;
    const anterior = raiz.style.overflow;
    raiz.style.overflow = 'hidden';
    painel.current?.querySelector<HTMLAnchorElement>('a')?.focus();

    function teclado(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        aoFechar();
        gatilho.current?.focus();
        return;
      }
      if (evento.key !== 'Tab' || !painel.current) return;
      const focaveis = Array.from(painel.current.querySelectorAll<HTMLElement>('a, button'));
      if (!focaveis.length) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis.at(-1);
      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo?.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener('keydown', teclado);
    return () => {
      raiz.style.overflow = anterior;
      document.removeEventListener('keydown', teclado);
    };
  }, [aberto, aoFechar, gatilho]);

  if (!aberto) return null;
  return (
    <div className="bg-bg/70 fixed inset-0 top-14 z-40 lg:hidden" onMouseDown={aoFechar}>
      <div
        ref={painel}
        id="painel-secoes"
        role="dialog"
        aria-label="Seções da página"
        className="chapa bg-surface max-h-[calc(100dvh-3.5rem)] overflow-y-auto px-6 py-6 motion-safe:animate-[assentar_200ms_cubic-bezier(.16,1,.3,1)]"
        onMouseDown={(evento) => evento.stopPropagation()}
      >
        <ProgressaoPainel progressao={progressao} />
        {LINKS.map(([href, texto]) => (
          <a
            key={href}
            href={href}
            onClick={aoFechar}
            className="border-border text-fg focus-visible:outline-accent flex min-h-12 items-center gap-4 border-b font-mono text-[11px] tracking-[0.14em] uppercase focus-visible:outline-2"
          >
            <span aria-hidden className="bg-accent h-3 w-px" />
            {texto}
          </a>
        ))}
        <a
          href="#candidatura"
          onClick={aoFechar}
          className="border-border text-fg-muted focus-visible:outline-accent mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-[3px] border font-mono text-[11px] tracking-[0.14em] uppercase focus-visible:outline-2"
        >
          Candidatar-se
        </a>
      </div>
    </div>
  );
}
