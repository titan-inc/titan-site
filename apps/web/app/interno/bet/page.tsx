import { redirect } from 'next/navigation';
import { getOddsBet, getRodadaBet, getRodadasBet, getSessionUser } from '../../../lib/api';
import { destinoDaPaginaBet } from './_components/acesso';
import { ListaDeRodadas } from './_components/lista-de-rodadas';
import { OddsEmJogo } from './_components/odds-em-jogo';

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

  // Odds em jogo (D-80): a rodada aberta é a primeira, a lista vem da mais recente.
  // Falha em qualquer leitura esconde a seção, sem derrubar a lista de rodadas.
  const aberta = lista.tipo === 'ok' ? lista.dados.rodadas.find((r) => r.fase === 'OPEN') : null;
  const [cardapio, odds] = aberta
    ? await Promise.all([getRodadaBet(aberta.roundId), getOddsBet(aberta.roundId)])
    : [null, null];

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

      {cardapio?.tipo === 'ok' && odds?.tipo === 'ok' && (
        <OddsEmJogo cardapio={cardapio.dados} odds={odds.dados} />
      )}

      {lista.tipo !== 'ok' ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Não foi possível carregar as rodadas agora.
        </p>
      ) : (
        <ListaDeRodadas rodadas={lista.dados.rodadas} base="/interno/bet" />
      )}
    </main>
  );
}
