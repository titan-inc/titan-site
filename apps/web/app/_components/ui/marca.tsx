interface MarcaProps {
  className?: string;
  detentesAcesas?: 0 | 1 | 2 | 3;
  titulo?: string;
}

/** A4 provisório: marca reduzida de legado, independente da progressão da navbar. */
export function Marca({ className = '', detentesAcesas = 2, titulo }: MarcaProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role={titulo ? 'img' : undefined}
      aria-hidden={titulo ? undefined : true}
      aria-label={titulo}
      fill="none"
    >
      <circle cx="32" cy="32" r="27" stroke="currentColor" strokeWidth="1.5" />
      {[
        { x1: 16, y1: 43, x2: 12, y2: 47 },
        { x1: 32, y1: 14, x2: 32, y2: 8 },
        { x1: 48, y1: 43, x2: 52, y2: 47 },
      ].map((detente, indice) => (
        <g key={indice} className={indice < detentesAcesas ? 'text-accent' : 'text-border'}>
          <line {...detente} stroke="currentColor" strokeWidth={indice < detentesAcesas ? 2 : 1} />
          {indice < detentesAcesas && (
            <circle cx={detente.x2} cy={detente.y2} r="2.25" fill="currentColor" />
          )}
        </g>
      ))}
      <line x1="32" y1="32" x2="43" y2="18" stroke="var(--color-accent)" strokeWidth="2" />
      <circle cx="32" cy="32" r="4" fill="var(--color-surface)" stroke="var(--color-edge)" />
    </svg>
  );
}
