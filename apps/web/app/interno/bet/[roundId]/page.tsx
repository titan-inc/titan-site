import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getClosingBet,
  getMeuSlipBet,
  getOddsBet,
  getRodadaBet,
  getSessionUser,
} from '../../../../lib/api';
import { destinoDaPaginaBet } from '../_components/acesso';
import { ApostasDaRodada } from '../_components/apostas-da-rodada';
import { ResultadosDaRodada } from '../_components/resultados-da-rodada';
import { FASE } from '../_components/rotulos';

export const metadata = { title: 'Rodada do Titan Bet — Titan Inc' };

/**
 * Uma rodada do Titan Bet: mercados, odds, o próprio slip e, depois, o Closing
 * Report. É a página que um post no Discord linka (Regra 7).
 *
 * Tudo lido no servidor, pelos contratos estritos do shared; o que escreve é o
 * client component, direto no Nest. O acesso é do `ApostadorDaRodadaGuard`
 * (D-53a): esta página segue a resposta da API (T-UI01).
 */
export default async function RodadaBetPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const [user, rodada] = await Promise.all([getSessionUser(), getRodadaBet(roundId)]);

  const destino = destinoDaPaginaBet(
    user,
    rodada.tipo === 'proibido' ? 'proibido' : rodada.tipo === 'ok' ? 'ok' : 'indisponivel',
  );
  if (destino) redirect(destino);

  if (rodada.tipo !== 'ok') {
    return (
      <main className="flex flex-1 flex-col gap-6">
        <Cabecalho />
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          {rodada.tipo === 'inexistente'
            ? 'Esta rodada não existe ou ainda não foi publicada.'
            : 'Não foi possível carregar a rodada agora.'}
        </p>
      </main>
    );
  }

  const [odds, slip, closing] = await Promise.all([
    getOddsBet(roundId),
    getMeuSlipBet(roundId),
    getClosingBet(roundId),
  ]);
  const cardapio = rodada.dados;

  return (
    <main className="flex flex-1 flex-col gap-8">
      <Cabecalho fase={FASE[cardapio.fase]} />

      <ApostasDaRodada
        cardapio={cardapio}
        odds={odds.tipo === 'ok' ? odds.dados : null}
        slip={slip.tipo === 'ok' ? slip.dados : null}
      />

      {closing.tipo === 'ok' && (
        <section className="flex flex-col gap-4">
          <h2 className="text-fg text-lg font-semibold tracking-tight">Resultados</h2>
          <ResultadosDaRodada closing={closing.dados} />
        </section>
      )}
    </main>
  );
}

function Cabecalho({ fase }: { fase?: string }) {
  return (
    <div>
      <p className="text-bronze font-mono text-xs tracking-widest uppercase">
        <Link href="/interno/bet" className="hover:text-accent">
          Titan Bet
        </Link>
        {fase ? ` · ${fase}` : ''}
      </p>
      <h1 className="text-fg mt-2 text-2xl font-semibold tracking-tight">Rodada da semana</h1>
    </div>
  );
}
