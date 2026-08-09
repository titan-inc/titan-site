import type { ReactNode, Ref } from 'react';
import { GlifoBattleNet } from './glifo-battlenet';

/**
 * Afordância do provedor de identidade, no idioma dele — como "entrar com o
 * Google". É a única superfície do site fora das três famílias cromáticas, e a
 * exceção está registrada no `globals.css`.
 *
 * O azul de assinatura do Battle.net (`#00aeff`) reprova 4,5:1 com texto
 * branco, então ele fica na aresta superior e no glifo; o preenchimento usa o
 * azul profundo, que mede 5,33:1. No hover o gradiente **achata** em vez de
 * clarear — clarear levaria o topo de volta para a faixa que reprova.
 *
 * O glifo é desenho original (ver `glifo-battlenet.tsx`), não o logotipo da
 * Blizzard: a exceção nominal da R4 cobre a key art da hero e mais nada.
 */
const CLASSES =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[4px] border-t border-b border-battlenet-lit/45 border-b-groove bg-linear-to-b from-battlenet to-battlenet-deep px-4 font-sans text-[13px] font-semibold text-battlenet-fg transition-colors hover:from-battlenet hover:to-battlenet focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60';

interface BotaoBattleNetProps {
  /** Sem rótulo visível: só o glifo, em alvo quadrado. Exige `aria-label`. */
  compacto?: boolean;
  children?: ReactNode;
  className?: string;
}

export function BotaoBattleNet({
  compacto = false,
  children,
  className = '',
  ref,
  ...resto
}: BotaoBattleNetProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      className={`${CLASSES} ${compacto ? 'aspect-square px-0' : ''} ${className}`}
      {...resto}
    >
      <GlifoBattleNet className="size-[18px] shrink-0" />
      {!compacto && <span className="whitespace-nowrap">{children}</span>}
    </button>
  );
}

/**
 * Mesma peça em forma de link.
 *
 * `/entrar` precisa de navegação de verdade do browser para o domínio da
 * Blizzard — é o caminho sem JavaScript, onde popup não existe.
 */
export function LinkBattleNet({
  children,
  className = '',
  ...resto
}: BotaoBattleNetProps & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={`${CLASSES} ${className}`} {...resto}>
      <GlifoBattleNet className="size-[18px] shrink-0" />
      <span className="whitespace-nowrap">{children}</span>
    </a>
  );
}
