import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getRodadasOfficer, getSessionUser } from '../../../lib/api';
import { FASE } from '../bet/_components/rotulos';
import { Quando } from '../mplus/_components/quando';
import { destinoDoPainel } from './_components/acesso';
import { CriarRodada } from './_components/criar-rodada';

export const metadata = { title: 'Titan Bet (officer) — Titan Inc' };

/**
 * O Officer Panel do Titan Bet: as rodadas, inclusive em preparação (T-C04), e
 * criar a da semana. A página esconde de quem não é officer; o `OfficerGuard`
 * no Nest é quem barra (Regra 5).
 */
export default async function BetOfficerPage() {
  const user = await getSessionUser();
  const destino = destinoDoPainel(user);
  if (destino) redirect(destino);

  const lista = await getRodadasOfficer();
  if (lista.tipo === 'proibido') redirect('/interno');

  return (
    <main className="flex flex-1 flex-col gap-8">
      <div>
        <p className="text-bronze font-mono text-xs tracking-widest uppercase">
          Titan Bet · Officer Panel
        </p>
        <h1 className="text-fg mt-2 text-2xl font-semibold tracking-tight">Rodadas</h1>
      </div>

      <CriarRodada />

      {lista.tipo !== 'ok' ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Não foi possível carregar as rodadas agora.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.dados.rodadas.map((r) => (
            <li key={r.roundId}>
              <Link
                href={`/interno/bet-officer/${r.roundId}`}
                className="border-border hover:bg-surface flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4 transition-colors"
              >
                <span className="text-fg text-sm font-medium">
                  Semana do reset de <Quando iso={r.opensAt} />
                </span>
                <span className="text-fg-muted font-mono text-xs uppercase">{FASE[r.fase]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
