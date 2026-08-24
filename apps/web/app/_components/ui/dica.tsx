'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Tempo parado em cima do gatilho antes do popover abrir — evita abrir a
 * cada peça que o cursor só atravessa a caminho de outro lugar. */
const ATRASO_PARA_ABRIR_MS = 350;

/** Tempo de graça ao sair do gatilho ou do popover, antes de fechar — dá
 * tempo do cursor atravessar o vão até o conteúdo, sem piscar. */
const ATRASO_PARA_FECHAR_MS = 100;

/** Vão entre o gatilho e o popover, e distância mínima da borda da viewport. */
const VAO_PX = 6;
const MARGEM_DA_VIEWPORT_PX = 8;

/** Largura estimada do popover, para não deixar `left` perto da borda direita
 * a ponto do conteúdo real (que ainda não foi medido) vazar da tela. Chute
 * deliberado — posicionamento à mão, sem lib, não faz medição em duas
 * passadas. */
const LARGURA_ESTIMADA_PX = 352;

/** Altura mínima que precisa sobrar ACIMA do gatilho para preferir esse lado;
 * abaixo desse valor o popover abre para baixo. */
const ALTURA_MINIMA_ACIMA_PX = 200;

interface DicaProps {
  /** O que dispara o hint. A Dica não sabe o que é — pode ser texto, ícone,
   * qualquer coisa. */
  gatilho: ReactNode;
  /** O conteúdo do popover. Idem — a Dica não sabe o que é. */
  children: ReactNode;
  className?: string;
}

/**
 * O primitivo de hint reutilizável — TIT-135. Cuida de posicionamento,
 * atraso de abertura, fechar ao sair e portal. Não sabe nada sobre o que é o
 * gatilho nem o conteúdo — quem sabe é quem usa (ex.: `TooltipDeItem`, no
 * Loot Council).
 *
 * **Hover apenas nesta versão.** Toque e teclado ficam para quando houver
 * necessidade — decisão consciente, registrada na issue para não parecer
 * esquecimento.
 *
 * **Sem dependência nova.** Posicionamento escrito à mão — `getBoundingClientRect`
 * do gatilho, recalculado ao abrir e ao rolar/redimensionar — como o resto de
 * `_components/ui/`.
 */
export function Dica({ gatilho, children, className = '' }: DicaProps) {
  const [aberto, setAberto] = useState(false);
  const [posicao, setPosicao] = useState<{ top: number; left: number; acima: boolean } | null>(
    null,
  );
  const gatilhoRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function limparTimer() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }

  function agendarAbertura() {
    limparTimer();
    timer.current = setTimeout(() => setAberto(true), ATRASO_PARA_ABRIR_MS);
  }

  function agendarFechamento() {
    limparTimer();
    timer.current = setTimeout(() => setAberto(false), ATRASO_PARA_FECHAR_MS);
  }

  // Nunca deixa um timer pendente disparar depois que o componente sumiu.
  useEffect(() => limparTimer, []);

  // Recalcula ao abrir e enquanto está aberto (rolar/redimensionar) — sem
  // isso, rolar um container que rola sozinho (a tabela do histórico, Regra
  // de container) deixa o popover flutuando longe do gatilho.
  useLayoutEffect(() => {
    if (!aberto) return;

    function posicionar() {
      const rect = gatilhoRef.current?.getBoundingClientRect();
      if (!rect) return;

      const left = Math.min(
        Math.max(rect.left, MARGEM_DA_VIEWPORT_PX),
        window.innerWidth - LARGURA_ESTIMADA_PX - MARGEM_DA_VIEWPORT_PX,
      );
      const acima = rect.top > ALTURA_MINIMA_ACIMA_PX;
      const top = acima ? rect.top - VAO_PX : rect.bottom + VAO_PX;

      setPosicao({ top, left, acima });
    }

    posicionar();
    window.addEventListener('scroll', posicionar, true);
    window.addEventListener('resize', posicionar);
    return () => {
      window.removeEventListener('scroll', posicionar, true);
      window.removeEventListener('resize', posicionar);
    };
  }, [aberto]);

  return (
    <span
      ref={gatilhoRef}
      className="inline-block"
      onMouseEnter={agendarAbertura}
      onMouseLeave={agendarFechamento}
    >
      {gatilho}

      {aberto && posicao && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="tooltip"
              onMouseEnter={limparTimer}
              onMouseLeave={agendarFechamento}
              className={`chapa bg-surface text-fg fixed z-[200] max-w-[min(22rem,90vw)] rounded-md p-3 text-sm ${className}`}
              style={{
                top: posicao.top,
                left: posicao.left,
                transform: posicao.acima ? 'translateY(-100%)' : undefined,
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
