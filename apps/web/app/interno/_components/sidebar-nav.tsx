'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';

/**
 * Itens da área interna.
 *
 * `segment` é o que `useSelectedLayoutSegment()` devolve — `null` em `/interno`
 * e o nome da pasta nas rotas filhas. Adicionar uma seção nova é acrescentar
 * uma linha aqui.
 */
const ITENS = [
  { segment: null, href: '/interno', label: 'Home' },
  { segment: 'roster', href: '/interno/roster', label: 'Roster' },
  { segment: 'progressao', href: '/interno/progressao', label: 'Progressão' },
  { segment: 'raid', href: '/interno/raid', label: 'Raid' },
] as const;

export function SidebarNav() {
  // Hook de client component: o layout é server component e importa este.
  const atual = useSelectedLayoutSegment();

  return (
    <nav aria-label="Área interna" className="flex gap-1 md:flex-col">
      {ITENS.map((item) => {
        const ativo = item.segment === atual;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={ativo ? 'page' : undefined}
            className={
              ativo
                ? 'bg-surface text-fg rounded-md px-3 py-2 text-sm font-medium'
                : 'text-fg-muted hover:bg-surface hover:text-fg rounded-md px-3 py-2 text-sm transition-colors'
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
