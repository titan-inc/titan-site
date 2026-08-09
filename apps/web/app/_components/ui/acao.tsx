import type { ReactNode } from 'react';

interface AcaoProps {
  children: ReactNode;
  variante: 'solida' | 'fantasma';
  href?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  'aria-describedby'?: string;
  className?: string;
}

export function Acao({
  children,
  variante,
  href,
  type = 'button',
  disabled,
  className = '',
  ...aria
}: AcaoProps) {
  const classes = `inline-flex min-h-11 items-center justify-center rounded-[3px] px-5 font-mono text-[11px] tracking-[0.14em] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${
    variante === 'solida'
      ? 'border-t border-edge border-b border-groove bg-accent text-bg hover:bg-accent/90'
      : 'border border-border text-fg-muted hover:border-fg-subtle hover:text-fg'
  } ${className}`;

  if (href)
    return (
      <a href={href} className={classes} {...aria}>
        {children}
      </a>
    );
  return (
    <button type={type} disabled={disabled} className={classes} {...aria}>
      {children}
    </button>
  );
}
