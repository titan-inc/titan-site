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
] as const;

/**
 * Home e M+ é tudo que existe para quem está na guilda mas acima do corte de
 * rank. As outras seções são do time de raid e mandariam a pessoa para uma
 * tela que a recusa — link que não leva a lugar nenhum é pior que link ausente.
 */
const ITENS_SEM_ACESSO = [{ segment: null, href: '/interno', label: 'Home' }] as const;

/** M+ não é raid: aparece para qualquer pessoa com personagem no roster. */
const ITEM_MPLUS = { segment: 'mplus', href: '/interno/mplus', label: 'M+' } as const;

/**
 * Seção de liderança. Fora de ITENS porque não é para todo mundo.
 *
 * Esconder o link é cortesia, não proteção: quem digitar a URL é barrado pela
 * página, e quem chamar a API é barrado pelo OfficerGuard — Regra 5.
 */
const ITENS_OFICIAL = [
  { segment: 'oficiais', href: '/interno/oficiais', label: 'Oficiais' },
] as const;

export function SidebarNav({
  oficial = false,
  acessoInterno = true,
}: {
  oficial?: boolean;
  /** Rank dentro do corte. Falso = membro da guilda sem a área do time de raid. */
  acessoInterno?: boolean;
}) {
  // Hook de client component: o layout é server component e importa este.
  const atual = useSelectedLayoutSegment();
  const base = acessoInterno ? ITENS : ITENS_SEM_ACESSO;
  const itens = [...base, ITEM_MPLUS, ...(oficial ? ITENS_OFICIAL : [])];

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
