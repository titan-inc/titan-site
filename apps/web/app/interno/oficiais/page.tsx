import { canManageOfficers } from '@titan/shared';
import { redirect } from 'next/navigation';
import { getOfficers, getSessionUser } from '../../../lib/api';
import { GestaoOficiais } from './_components/gestao-oficiais';

export const metadata = { title: 'Oficiais — Titan Inc' };

/**
 * Quem é oficial. A lista diz quem vê o histórico dos outros e quem promove,
 * então ela mesma é de oficial.
 *
 * Isto é UX — quem barra de verdade é o OfficerGuard no Nest (Regra 5).
 */
export default async function OficiaisPage() {
  const user = await getSessionUser();
  if (!user) redirect('/?erro=sessao');
  if (!user.hasInternalAccess) redirect('/interno');
  if (!canManageOfficers(user)) redirect('/interno');

  const lista = await getOfficers();

  return (
    <main className="flex flex-1 flex-col gap-6">
      <div>
        <p className="text-bronze font-mono text-xs tracking-widest uppercase">Liderança</p>
        <h1 className="text-fg mt-2 text-2xl font-semibold tracking-tight">Oficiais</h1>
        <p className="text-fg-muted mt-2 text-sm">
          São duas fontes, e basta uma: quem está nos ranks de oficial da guilda entra
          automaticamente, e quem não está pode receber a concessão à mão, personagem por
          personagem.
        </p>
        <p className="text-fg-subtle mt-2 text-sm">
          Vale por pessoa, não por personagem: quem tem qualquer um dos seus personagens aqui é
          oficial em todos eles. Conceder antes de a pessoa logar no site funciona — a concessão
          espera a conta aparecer.
        </p>
      </div>

      {lista === null ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Não foi possível carregar a lista agora.
        </p>
      ) : (
        <GestaoOficiais inicial={lista} />
      )}
    </main>
  );
}
