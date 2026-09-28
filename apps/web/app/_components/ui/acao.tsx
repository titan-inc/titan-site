import type { ReactNode } from 'react';

interface AcaoProps {
  children: ReactNode;
  variante: 'solida' | 'fantasma' | 'perigo';
  href?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
  'aria-describedby'?: string;
  className?: string;
}

export function Acao({
  children,
  variante,
  href,
  type = 'button',
  disabled,
  onClick,
  className = '',
  ...aria
}: AcaoProps) {
  const classes = `inline-flex min-h-11 items-center justify-center rounded-[3px] px-5 font-mono text-[11px] tracking-[0.14em] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${
    variante === 'solida'
      ? 'acao-solida border-t border-edge border-b border-groove bg-accent text-bg'
      : variante === 'perigo'
        ? 'acao-perigo border border-red-400/60 text-red-400'
        : 'acao-fantasma border border-border text-fg-muted'
  } ${className}`;

  if (href)
    return (
      <a href={href} className={classes} {...aria}>
        {children}
      </a>
    );
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={classes} {...aria}>
      {children}
    </button>
  );
}
