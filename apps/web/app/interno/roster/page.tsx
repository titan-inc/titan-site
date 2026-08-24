import { redirect } from 'next/navigation';
import { getRoster, getSessionUser } from '../../../lib/api';
import { RosterTable } from './_components/roster-table';

export const metadata = { title: 'Roster — Titan Inc' };

/**
 * Roster do time de raid.
 *
 * A lista vem do WoWAudit, curada à mão pelo raid leader — não do rank da
 * guilda. Rank alto não quer dizer que a pessoa está raidando, e o time
 * atravessa 6 realms, então filtrar o roster da guilda nunca daria esta lista.
 *
 * A tabela é client component porque ordena sem ida ao servidor: são 22 linhas
 * e o raid leader troca de coluna várias vezes seguidas comparando gente.
 */
export default async function RosterPage() {
  const user = await getSessionUser();
  if (!user) redirect('/?erro=sessao');
  if (!user.hasInternalAccess) redirect('/interno');

  const roster = await getRoster();

  return (
    <>
      <p className="text-fg-muted text-sm">
        Quem está no time hoje, segundo o WoWAudit. Item level e score de M+ vêm do Raider.IO.
        Clique no cabeçalho para ordenar.
      </p>

      {roster === null ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Não foi possível carregar o roster agora. Tente recarregar em alguns instantes.
        </p>
      ) : (
        <>
          {roster.enrichmentFailed && (
            <p className="border-border bg-surface text-fg-muted rounded-lg border p-4 text-sm">
              O Raider.IO não respondeu, então item level e score estão faltando. O time abaixo está
              correto.
            </p>
          )}

          <RosterTable characters={roster.characters} />

          <p className="text-fg-subtle text-xs">
            {roster.characters.length} personagens · atualizado em{' '}
            {new Date(roster.fetchedAt).toLocaleString('pt-BR')}
          </p>
        </>
      )}
    </>
  );
}
