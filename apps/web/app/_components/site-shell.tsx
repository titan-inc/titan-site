'use client';
import type { SessionUser } from '@titan/shared';
import type { ResumoProgressaoNav } from '../../lib/progressao/resumo-nav';
import { usePathname } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { ErroLoginNaUrl } from './auth/erro-login-na-url';
import { SiteFooter } from './site-footer';
import { SiteNav } from './site-nav';
export function SiteShell({
  children,
  sessao,
  progressao,
}: {
  children: ReactNode;
  sessao: SessionUser | null;
  progressao: ResumoProgressaoNav | null;
}) {
  const caminho = usePathname();
  if (caminho !== '/') return <>{children}</>;
  return (
    <>
      <a
        href="#conteudo"
        className="chapa text-fg focus-visible:outline-accent fixed top-3 left-3 z-[100] -translate-y-24 px-4 py-3 text-sm transition-transform focus:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        Pular para o conteúdo
      </a>
      {/* `Suspense` obrigatório: `ErroLoginNaUrl` usa `useSearchParams`, e sem a
          fronteira a árvore inteira acima dele deixa de ser prerenderizada — a
          build falha ao exportar `/`. Com ela, só este componente é resolvido no
          cliente, e ele não pinta nada até haver erro. Ver a doc do Next 16 em
          `use-search-params.md`. */}
      <Suspense fallback={null}>
        <ErroLoginNaUrl />
      </Suspense>
      <SiteNav sessao={sessao} progressao={progressao} />
      <main id="conteudo" className="flex flex-1 flex-col" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
