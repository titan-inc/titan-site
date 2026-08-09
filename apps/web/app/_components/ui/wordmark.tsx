import type { ElementType } from 'react';

interface WordmarkProps {
  as?: ElementType;
  className?: string;
  tamanho?: 'mobile' | 'nav' | 'footer';
}

const TAMANHOS = {
  mobile: 'text-[18px]',
  nav: 'text-[22px]',
  footer: 'text-[34px]',
} as const;

export function Wordmark({
  as: Componente = 'span',
  className = '',
  tamanho = 'nav',
}: WordmarkProps) {
  return (
    <Componente
      aria-label="Titan Inc"
      style={{ fontStretch: '112%' }}
      className={`wordmark relative inline-flex items-center font-sans leading-none font-extrabold tracking-[-0.02em] text-current ${TAMANHOS[tamanho]} ${className}`}
    >
      <span aria-hidden="true">TITAN</span>
      <span aria-hidden="true" className="letra-fel wordmark-inc ml-[0.06em]">
        INC
      </span>
    </Componente>
  );
}
