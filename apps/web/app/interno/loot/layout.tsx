import { isActingOfficer } from '@titan/shared';
import { redirect } from 'next/navigation';
import { getSessionUser } from '../../../lib/api';
import { AbasLoot } from './_components/abas-loot';

/**
 * Casca da área de Loot: cabeçalho + abas + conteúdo.
 *
 * As abas vivem aqui, e não em cada página, para trocar de aba não remontar a
 * barra — mesma razão pela qual a navegação lateral mora no layout de cima.
 *
 * Quem entra é quem já está na área interna: o "core" é exatamente o corte que
 * `canAccessInternalArea()` já aplica, então não há permissão nova aqui.
 *
 * Isto é UX, não segurança (Regra 5). Quem barra de verdade é o guard no Nest,
 * em cada endpoint que estas telas vierem a chamar.
 */
export default async function LootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/?erro=sessao');
  if (!user.hasInternalAccess) redirect('/interno');

  return (
    <main className="flex flex-1 flex-col gap-6">
      <div>
        <p className="text-bronze font-mono text-xs tracking-widest uppercase">Conselho</p>
        <h1 className="text-fg mt-2 text-2xl font-semibold tracking-tight">Loot</h1>
        <p className="text-fg-muted mt-2 text-sm">
          A sessão em andamento, o histórico do que o conselho já distribuiu, e o que dá para
          configurar.
        </p>
      </div>

      {/* `isActingOfficer` e não `canManageOfficers`: aqui a pergunta é a
          precondição genérica de oficial, não a permissão específica de mexer na
          lista de oficiais. Usar a específica passaria a mentir no dia em que as
          duas divergissem. */}
      <AbasLoot oficial={isActingOfficer(user)} />

      {children}
    </main>
  );
}
