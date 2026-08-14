'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';

/**
 * As abas da área de Loot.
 *
 * `segment` é o que `useSelectedLayoutSegment()` devolve **um nível abaixo** do
 * layout que chama — `null` em `/interno/loot` e o nome da pasta nas filhas.
 * Mesmo contrato do `sidebar-nav`, um nível mais fundo.
 */
const ABAS = [
  { segment: null, href: '/interno/loot', label: 'Sessão' },
  { segment: 'historico', href: '/interno/loot/historico', label: 'Histórico' },
] as const;

/**
 * Configuração fica fora de ABAS porque não é para todo mundo.
 *
 * Esconder é cortesia, não proteção: quem digitar a URL é barrado pela página, e
 * quem chamar a API é barrado pelo guard no Nest — Regra 5.
 */
const ABA_OFICIAL = {
  segment: 'configuracao',
  href: '/interno/loot/configuracao',
  label: 'Configuração',
} as const;

export function AbasLoot({ oficial = false }: { oficial?: boolean }) {
  const atual = useSelectedLayoutSegment();
  const abas = oficial ? [...ABAS, ABA_OFICIAL] : ABAS;

  return (
    <nav aria-label="Seções de loot" className="border-border -mb-px flex gap-1 border-b">
      {abas.map((aba) => {
        const ativa = aba.segment === atual;

        return (
          <Link
            key={aba.href}
            href={aba.href}
            aria-current={ativa ? 'page' : undefined}
            className={
              ativa
                ? 'border-accent text-fg -mb-px border-b-2 px-3 py-2 text-sm font-medium'
                : 'text-fg-muted hover:text-fg -mb-px border-b-2 border-transparent px-3 py-2 text-sm transition-colors'
            }
          >
            {aba.label}
          </Link>
        );
      })}
    </nav>
  );
}
