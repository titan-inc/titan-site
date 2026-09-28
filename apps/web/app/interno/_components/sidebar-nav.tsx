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

  // Em ITENS e não em ITENS_OFICIAL: a área de Loot é do "core", que é
  // exatamente quem já passou pelo corte da área interna. Um segundo corte com
  // o mesmo valor seria só mais um lugar para divergir do primeiro em silêncio.
  { segment: 'loot', href: '/interno/loot', label: 'Loot' },
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
 * Titan Bet também é de qualquer um na guilda (D-01): o corte de rank é da
 * ferramenta do time de raid, não das apostas.
 */
const ITEM_BET = { segment: 'bet', href: '/interno/bet', label: 'Titan Bet' } as const;

/**
 * O Officer Panel do Titan Bet, para quem passa na **precondição** de oficial
 * (`isActingOfficer`, a do `OfficerGuard`) — não na permissão de gerir
 * oficiais, que decide outra coisa (CLAUDE.md, Regra 4). Cortesia; quem barra é
 * o guard (Regra 5).
 */
const ITEM_BET_OFFICER = {
  segment: 'bet-officer',
  href: '/interno/bet-officer',
  label: 'Titan Bet (officer)',
} as const;

/**
 * Seção de liderança. Fora de ITENS porque não é para todo mundo.
 *
 * Esconder o link é cortesia, não proteção: quem digitar a URL é barrado pela
 * página, e quem chamar a API é barrado pelo OfficerGuard — Regra 5.
 */
const ITENS_OFICIAL = [
  { segment: 'oficiais', href: '/interno/oficiais', label: 'Oficiais' },
] as const;

/**
 * Presença, para quem passa em `canSeeOthersHistory` — a mesma função que a
 * página checa, e **não** a de gerir oficiais.
 *
 * Fora de ITENS_OFICIAL de propósito: aquele é gateado por `canManageOfficers`,
 * que hoje tem o mesmo corpo e decide outra coisa (CLAUDE.md, Regra 4). Casar o
 * link com a permissão errada funciona até as duas divergirem, e aí o link
 * passa a mandar gente para um redirect sem ninguém entender por quê.
 *
 * Saiu de ITENS na TIT-150, quando a visão de membro da presença foi removida.
 */
const ITEM_PRESENCA = {
  segment: 'presenca',
  href: '/interno/presenca',
  label: 'Presença',
} as const;

/** Rotação de banco, pelo mesmo gate da Presença — as duas são a Regra 7. */
const ITEM_ROTACAO = {
  segment: 'rotacao',
  href: '/interno/rotacao',
  label: 'Rotação',
} as const;

interface Item {
  readonly segment: string | null;
  readonly href: string;
  readonly label: string;
}

export function SidebarNav({
  oficial = false,
  officer = false,
  historico = false,
  acessoInterno = true,
}: {
  oficial?: boolean;
  /** `isActingOfficer`: o Officer Panel do Titan Bet. */
  officer?: boolean;
  /** `canSeeOthersHistory`: a Presença. Ver `ITEM_PRESENCA`. */
  historico?: boolean;
  /** Rank dentro do corte. Falso = membro da guilda sem a área do time de raid. */
  acessoInterno?: boolean;
}) {
  // Hook de client component: o layout é server component e importa este.
  const atual = useSelectedLayoutSegment();
  const base = acessoInterno ? ITENS : ITENS_SEM_ACESSO;

  const comuns: readonly Item[] = [...base, ITEM_MPLUS, ITEM_BET];

  // As três entram por permissões DIFERENTES (ver cada constante). Hoje a
  // população é a mesma, então agrupar não mente; se um dia divergirem, a
  // seção encolhe por pessoa, que é o comportamento certo.
  const lideranca: readonly Item[] = [
    ...(historico ? [ITEM_PRESENCA, ITEM_ROTACAO] : []),
    ...(oficial ? ITENS_OFICIAL : []),
    ...(officer ? [ITEM_BET_OFFICER] : []),
  ];

  /**
   * `pedra-lit` e não uma cor nova: a paleta tem três famílias de propósito, e
   * o quente dela é a pedra oliva. 10,2:1 sobre o fundo e 9,2:1 sobre a
   * superfície, então o realce não custa legibilidade.
   */
  const item = (i: Item, daLideranca: boolean) => {
    const ativo = i.segment === atual;
    const cor = daLideranca
      ? ativo
        ? 'bg-surface text-pedra-lit font-medium'
        : 'text-pedra-lit/80 hover:bg-surface hover:text-pedra-lit'
      : ativo
        ? 'bg-surface text-fg font-medium'
        : 'text-fg-muted hover:bg-surface hover:text-fg';

    return (
      <Link
        key={i.href}
        href={i.href}
        aria-current={ativo ? 'page' : undefined}
        className={`shrink-0 rounded-md px-3 py-2 text-sm transition-colors ${cor}`}
      >
        {i.label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Área interna"
      className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
    >
      {comuns.map((i) => item(i, false))}

      {lideranca.length > 0 && (
        // A cor sozinha não é sinal acessível, então o rótulo é o sinal de
        // verdade e a cor é reforço. No mobile o nav é uma tira horizontal com
        // scroll, onde rótulo de seção não cabe — ali vira um fio vertical, que
        // é decorativo e some do leitor de tela.
        <div className="flex shrink-0 items-center md:block">
          <span aria-hidden className="bg-border mx-1 h-5 w-px md:hidden" />
          {/* Mesma forma e recuo do "Área interna" do layout: `font-mono
              text-xs tracking-widest uppercase`, sem padding lateral, porque os
              links têm `px-3` e a régua dos rótulos é a borda do aside. Só a
              cor muda — é ela que marca a seção. */}
          <span className="text-pedra hidden pt-5 pb-2 font-mono text-xs tracking-widest uppercase md:block">
            Liderança
          </span>
        </div>
      )}

      {lideranca.map((i) => item(i, true))}
    </nav>
  );
}
