import { redirect } from 'next/navigation';
import { getRaidProgress, getSessionUser } from '../../../lib/api';
import { RaidProgressTable } from './_components/raid-progress-table';

export const metadata = { title: 'Raid — Titan Inc' };

/**
 * Progressão de boss do tier, por season.
 *
 * **Uma season pode ter mais de uma raid.** Nesta, o Warcraft Logs junta as
 * três num tier só chamado "VS / DR / MQD"; quem separa é a instância do jogo
 * de cada pull. A página agrupa por raid de verdade porque é assim que o time
 * fala — ninguém diz "estamos no VS / DR / MQD".
 */
export default async function RaidPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/entrar');
  if (!user.hasInternalAccess) redirect('/interno');

  const { season } = await searchParams;
  const report = await getRaidProgress(season);

  return (
    <main className="flex flex-1 flex-col gap-6">
      <div>
        <p className="text-bronze font-mono text-xs tracking-widest uppercase">Time de raid</p>
        <h1 className="text-fg mt-2 text-2xl font-semibold tracking-tight">Progressão de raid</h1>
        <p className="text-fg-muted mt-2 text-sm">
          Kill de cada boss do tier, direto dos logs. Onde ainda não houve kill, o número é o melhor
          wipe — a vida que sobrou para o boss na melhor tentativa.
        </p>
      </div>

      {report === null ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Sem progressão para mostrar agora. Ou ainda não há season gravada, ou o Warcraft Logs não
          respondeu — a página não inventa dado nem para um caso nem para o outro.
        </p>
      ) : (
        <>
          <RaidProgressTable report={report} />

          <p className="text-fg-subtle text-xs">
            Só pull de boss de raid entra na conta: trash e dungeon de M+ aparecem no mesmo
            relatório do Warcraft Logs e são descartadas pull a pull. Nenhuma pull é ignorada por
            ser curta.
          </p>
        </>
      )}
    </main>
  );
}
