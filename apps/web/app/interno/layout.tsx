import Link from 'next/link';
import { Wordmark } from '../_components/ui/wordmark';
import { SidebarNav } from './_components/sidebar-nav';

/**
 * Casca da área interna: barra lateral + conteúdo.
 *
 * A navegação fica aqui, e não em cada página, para que trocar de seção não
 * remonte a barra.
 *
 * Isto é UX, não segurança — ver Regra 5. Quem esconde de verdade é o
 * MemberGuard no Nest; a barra só evita tela quebrada.
 */
export default function InternoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8 md:flex-row md:gap-10">
      <aside className="md:w-44 md:shrink-0">
        {/* A área interna não tem navbar — `SiteShell` só monta a casca em `/`.
            Sem isto, quem cai num estado sem acesso fica sem nenhuma saída a não
            ser o botão do navegador. O wordmark é a âncora de casa, e vale para
            todas as rotas internas de uma vez. */}
        <Link
          href="/"
          className="text-fg hover:text-accent focus-visible:outline-accent mb-5 inline-flex min-h-11 items-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Wordmark tamanho="mobile" />
        </Link>
        <p className="text-fg-subtle mb-3 hidden font-mono text-xs tracking-widest uppercase md:block">
          Área interna
        </p>
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
