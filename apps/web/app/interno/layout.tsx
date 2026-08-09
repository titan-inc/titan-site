import { canManageOfficers } from '@titan/shared';
import { getSessionUser } from '../../lib/api';
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
export default async function InternoLayout({ children }: { children: React.ReactNode }) {
  // Só para decidir se a seção de liderança aparece na barra. A página e o
  // guard do Nest decidem o acesso de verdade.
  const user = await getSessionUser();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8 md:flex-row md:gap-10">
      <aside className="md:w-44 md:shrink-0">
        <p className="text-fg-subtle mb-3 hidden font-mono text-xs tracking-widest uppercase md:block">
          Área interna
        </p>
        <SidebarNav oficial={user !== null && canManageOfficers(user)} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
