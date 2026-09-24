import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getRodadasBet, getSessionUser } from '../../../lib/api';
import { Quando } from '../mplus/_components/quando';
import { destinoDaPaginaBet } from './_components/acesso';
import { FASE } from './_components/rotulos';

export const metadata = { title: 'Titan Bet — Titan Inc' };

/**
 * As rodadas do Titan Bet que a conta pode abrir, a mais recente primeiro.
 *
 * Não redireciona por `membership`: quem saiu da guilda com slip numa rodada
 * continua nela (D-53a). Quem decide é o `ApostadorDaRodadaGuard` no Nest; esta
 * página segue a resposta da API (T-UI01).
 */
export default async function BetPage() {
  const [user, lista] = await Promise.all([getSessionUser(), getRodadasBet()]);
  const destino = destinoDaPaginaBet(
    user,
    lista.tipo === 'ok' ? 'ok' : lista.tipo === 'proibido' ? 'proibido' : 'indisponivel',
  );
  if (destino) redirect(destino);

  return (
    <main className="flex flex-1 flex-col gap-8">
      <div>
        <p className="text-bronze font-mono text-xs tracking-widest uppercase">Titan Bet</p>
        <h1 className="text-fg mt-2 text-2xl font-semibold tracking-tight">Rodadas</h1>
        <p className="text-fg-muted mt-2 max-w-2xl text-sm">
          Uma rodada por semana: mercados da raid de terça e quinta, apostas até o reset e
          resultados publicados depois da auditoria.
        </p>
      </div>

      {lista.tipo !== 'ok' ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Não foi possível carregar as rodadas agora.
        </p>
      ) : lista.dados.rodadas.length === 0 ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Nenhuma rodada publicada ainda.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.dados.rodadas.map((r) => (
            <li key={r.roundId}>
              <Link
                href={`/interno/bet/${r.roundId}`}
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
