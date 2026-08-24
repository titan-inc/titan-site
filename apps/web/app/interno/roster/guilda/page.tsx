import { isActingOfficer } from '@titan/shared';
import { redirect } from 'next/navigation';
import { getGuildRoster, getSessionUser } from '../../../../lib/api';
import { GuildRosterTable } from './_components/guild-roster-table';

export const metadata = { title: 'Roster da guilda — Titan Inc' };

/**
 * Roster completo da guilda (~590), diferente da aba "Time de raid".
 *
 * Só oficial (Regra 4): o redirect aqui é cortesia — quem barra de verdade é
 * o `OfficerGuard` no endpoint (Regra 5). Battletag só aparece para quem já
 * logou no site pelo menos uma vez; a Blizzard não expõe o de conta alheia.
 */
export default async function GuildRosterPage() {
  const user = await getSessionUser();
  if (!user) redirect('/?erro=sessao');
  if (!isActingOfficer(user)) redirect('/interno/roster');

  const roster = await getGuildRoster();

  return (
    <>
      <p className="text-fg-muted text-sm">
        Todo mundo com personagem na guilda, direto da Blizzard. BNet# só aparece para quem já logou
        no site — a Blizzard não mostra o de conta alheia. Clique no cabeçalho para ordenar.
      </p>

      {roster === null ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Não foi possível carregar o roster da guilda agora. Tente recarregar em alguns instantes.
        </p>
      ) : (
        <>
          <GuildRosterTable members={roster.members} />

          <p className="text-fg-subtle text-xs">
            {roster.members.length} personagens · atualizado em{' '}
            {new Date(roster.fetchedAt).toLocaleString('pt-BR')}
          </p>
        </>
      )}
    </>
  );
}
