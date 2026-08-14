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
  { segment: 'presenca', href: '/interno/presenca', label: 'Presença' },

  // Em ITENS e não em ITENS_OFICIAL: a área de Loot é do "core", que é
  // exatamente quem já passou pelo corte da área interna. Um segundo corte com
  // o mesmo valor seria só mais um lugar para divergir do primeiro em silêncio.
  { segment: 'loot', href: '/interno/loot', label: 'Loot' },
] as const;

/**
 * Seção de liderança. Fora de ITENS porque não é para todo mundo.
 *
 * Esconder o link é cortesia, não proteção: quem digitar a URL é barrado pela
 * página, e quem chamar a API é barrado pelo OfficerGuard — Regra 5.
 */
const ITENS_OFICIAL = [
  { segment: 'oficiais', href: '/interno/oficiais', label: 'Oficiais' },
] as const;

export function SidebarNav({ oficial = false }: { oficial?: boolean }) {
  // Hook de client component: o layout é server component e importa este.
  const atual = useSelectedLayoutSegment();
  const itens = oficial ? [...ITENS, ...ITENS_OFICIAL] : ITENS;

  return (
    <nav aria-label="Área interna" className="flex gap-1 md:flex-col">
      {itens.map((item) => {
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
