import type { LootHistoryPage } from '@titan/shared';
import Link from 'next/link';
import type { BuscaHistorico } from './historico-url';

/**
 * Navegação entre páginas do histórico.
 *
 * `<Link>` e não botão com `router.push`: a página é server component, e link de
 * verdade dá "abrir em nova aba" e URL copiável de graça. O estado da tela mora
 * na URL — ver o comentário da página.
 */
export function Paginacao({ pagina, busca }: { pagina: LootHistoryPage; busca: BuscaHistorico }) {
  const ultima = Math.max(1, Math.ceil(pagina.total / pagina.pageSize));
  if (ultima === 1) return null;

  const href = (n: number): string => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(busca)) {
      if (k !== 'page' && v !== undefined && v !== '') params.set(k, v);
    }
    params.set('page', String(n));

    return `/interno/loot/historico?${params.toString()}`;
  };

  return (
    <nav aria-label="Páginas do histórico" className="flex items-center gap-3 text-sm">
      <Passo href={href(pagina.page - 1)} desabilitado={pagina.page <= 1}>
        Anterior
      </Passo>

      <span className="text-fg-subtle font-mono text-xs tabular-nums">
        {pagina.page} / {ultima}
      </span>

      <Passo href={href(pagina.page + 1)} desabilitado={pagina.page >= ultima}>
        Próxima
      </Passo>
    </nav>
  );
}

/**
 * Um passo da navegação.
 *
 * Desabilitado vira `<span>`, e não link com `aria-disabled`: link que não leva
 * a lugar nenhum continua focável e clicável, e prometer navegação que não
 * acontece é pior que não oferecer.
 */
function Passo({
  href,
  desabilitado,
  children,
}: {
  href: string;
  desabilitado: boolean;
  children: React.ReactNode;
}) {
  if (desabilitado) {
    return <span className="text-fg-subtle min-h-11 px-3 py-2">{children}</span>;
  }

  return (
    <Link
      href={href}
      className="text-fg-muted hover:text-fg hover:bg-surface min-h-11 rounded-md px-3 py-2 transition-colors"
    >
      {children}
    </Link>
  );
}
