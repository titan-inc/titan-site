import { canManageOfficers } from '@titan/shared';
import { redirect } from 'next/navigation';
import { getOfficers, getSessionUser } from '../../../lib/api';
import { GestaoOficiais } from './_components/gestao-oficiais';

export const metadata = { title: 'Oficiais — Titan Inc' };

/**
 * Quem é oficial.
 *
 * A lista diz quem enxerga dado pessoal de candidato e o histórico de todo
 * mundo, então ela mesma é de oficial — não é informação pública da guilda.
 * Membro que digitar a URL vai para /interno, e não para uma tela vazia.
 *
 * Isto é UX. Quem esconde de verdade é o OfficerGuard no Nest — Regra 5.
 */
export default async function OficiaisPage() {
  const user = await getSessionUser();
  if (!user) redirect('/entrar');
  if (!user.hasInternalAccess) redirect('/interno');
  if (!canManageOfficers(user)) redirect('/interno');

  const lista = await getOfficers();

  return (
    <main className="flex flex-1 flex-col gap-6">
      <div>
        <p className="text-bronze font-mono text-xs tracking-widest uppercase">Liderança</p>
        <h1 className="text-fg mt-2 text-2xl font-semibold tracking-tight">Oficiais</h1>
        <p className="text-fg-muted mt-2 text-sm">
          Lista manual, personagem por personagem — nunca derivada do rank da guilda. Rank é
          posicional: reordenar os ranks no jogo mudaria quem é oficial sem ninguém decidir nada.
        </p>
        <p className="text-fg-subtle mt-2 text-sm">
          Vale por pessoa, não por personagem: quem tem qualquer um dos seus personagens nesta lista
          é oficial em todos eles. Conceder antes de a pessoa logar no site funciona — a concessão
          espera a conta aparecer.
        </p>
      </div>

      {lista === null ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Não foi possível carregar a lista agora.
        </p>
      ) : (
        <GestaoOficiais inicial={lista.grants} />
      )}
    </main>
  );
}
