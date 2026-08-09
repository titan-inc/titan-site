import type { ElementType, ReactNode } from 'react';

interface RotuloProps {
  children: ReactNode;
  as?: ElementType;
  className?: string;
}

export function Rotulo({ children, as: Componente = 'p', className = '' }: RotuloProps) {
  return (
    <Componente
      className={`text-fg-subtle font-mono text-[11px] tracking-[0.14em] uppercase ${className}`}
    >
      {children}
    </Componente>
  );
}
