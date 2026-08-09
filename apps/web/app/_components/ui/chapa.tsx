import type { ElementType, ReactNode } from 'react';

interface ChapaProps {
  children: ReactNode;
  nivel?: 'plana' | 'elevada';
  as?: ElementType;
  className?: string;
}

export function Chapa({
  children,
  nivel = 'elevada',
  as: Componente = 'div',
  className = '',
}: ChapaProps) {
  return (
    <Componente className={`${nivel === 'elevada' ? 'chapa' : ''} ${className}`}>
      {children}
    </Componente>
  );
}
