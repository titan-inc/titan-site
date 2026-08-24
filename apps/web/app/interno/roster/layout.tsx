import { isActingOfficer } from '@titan/shared';
import { redirect } from 'next/navigation';
import { getSessionUser } from '../../../lib/api';
import { AbasRoster } from './_components/abas-roster';

/**
 * Casca do Roster: cabeçalho + abas + conteúdo.
 *
 * As abas vivem aqui, e não em cada página, pelo mesmo motivo do `LootLayout`:
 * trocar de aba não remonta a barra.
 *
 * Quem entra é quem já está na área interna — o corte de `canAccessInternalArea()`
 * já aplicado. A aba "Guilda" só aparece para oficial (Regra 4); isto é UX, não
 * segurança (Regra 5) — quem barra de verdade é o `OfficerGuard` no Nest.
 */
export default async function RosterLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/?erro=sessao');
  if (!user.hasInternalAccess) redirect('/interno');

  return (
    <main className="flex flex-1 flex-col gap-6">
      <div>
        <p className="text-pedra font-mono text-xs tracking-widest uppercase">Roster</p>
        <h1 className="text-fg mt-2 text-[34px] leading-[1.05] font-extrabold tracking-[-0.02em]">
          Roster
        </h1>
      </div>

      <AbasRoster oficial={isActingOfficer(user)} />

      {children}
    </main>
  );
}
