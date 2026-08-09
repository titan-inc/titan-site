import { redirect } from 'next/navigation';
import { getProgress, getSessionUser } from '../../../lib/api';
import { ProgressTable } from './_components/progress-table';

export const metadata = { title: 'Progressão — Titan Inc' };

/**
 * Chaves feitas e evolução de item level, por semana da season.
 *
 * **A tela avisa em que semana está, de propósito.** O mesmo número de chaves
 * significa coisas opostas dependendo do momento: no começo da season é gente
 * se gearando, no fim é gente empurrando IO. Sem o contexto da semana, o
 * relatório entregaria ambiguidade com cara de fato.
 */
export default async function ProgressaoPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/entrar');
  if (!user.hasInternalAccess) redirect('/interno');

  const { season } = await searchParams;
  const report = await getProgress(season);

  return (
    <main className="flex flex-1 flex-col gap-6">
      <div>
        <p className="text-pedra font-mono text-xs tracking-widest uppercase">Time de raid</p>
        <h1 className="text-fg mt-2 text-[34px] leading-[1.05] font-extrabold tracking-[-0.02em]">
          Progressão
        </h1>
        <p className="text-fg-muted mt-2 text-sm">
          Chaves feitas e evolução de item level. O número ao lado de cada valor é a distância para
          a média do time.
        </p>
      </div>

      {report === null ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Ainda não há semana gravada. O snapshot roda diariamente e a primeira foto aparece aqui
          assim que ele rodar.
        </p>
      ) : (
        <>
          <ProgressTable report={report} />

          <p className="text-fg-subtle text-xs">
            Este relatório vale mais no começo da season. Conforme ela avança, quem faz chave está
            empurrando IO e não se gearando — o mesmo número passa a significar outra coisa.
          </p>
        </>
      )}
    </main>
  );
}
