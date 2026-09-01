import type { ReactNode } from 'react';
import { GlifoBattleNet } from './glifo-battlenet';

/**
 * Afordância do provedor de identidade, no idioma dele — como "entrar com o
 * Google". É a única superfície do site fora das três famílias cromáticas, e a
 * exceção está registrada no `globals.css`.
 *
 * Houve uma variante `<button>` aqui até a TIT-148, para o login por popup.
 * Saiu junto com ele: botão sem `onClick` é convite a religar um handler, e o
 * ponto da mudança é que o login não tem mais nada para JavaScript fazer.
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
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[4px] border-t border-b border-battlenet-lit/45 border-b-groove bg-linear-to-b from-battlenet to-battlenet-deep px-4 font-sans text-[13px] font-semibold text-battlenet-fg transition-colors hover:from-battlenet hover:to-battlenet focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

interface BotaoBattleNetProps {
  /** Sem rótulo visível: só o glifo, em alvo quadrado. Exige `aria-label`. */
  compacto?: boolean;
  children?: ReactNode;
  className?: string;
}

/**
 * O login, em forma de link — a única forma desde a TIT-148.
 *
 * O OAuth precisa de navegação de verdade do browser para o domínio da
 * Blizzard. Sendo `<a>`, isso é o comportamento padrão do elemento: funciona
 * sem JavaScript, aceita abrir em nova aba pelo menu do navegador, e não tem
 * como ficar preso num estado de "aguardando" que nunca sai.
 *
 * `compacto` é tratado aqui, e não só herdado do tipo: sem isto ele vazaria
 * pelo `...resto` e viraria atributo inválido no DOM.
 */
export function LinkBattleNet({
  compacto = false,
  children,
  className = '',
  ...resto
}: BotaoBattleNetProps & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={`${CLASSES} ${compacto ? 'aspect-square px-0' : ''} ${className}`} {...resto}>
      <GlifoBattleNet className="size-[18px] shrink-0" />
      {!compacto && <span className="whitespace-nowrap">{children}</span>}
    </a>
  );
}
