import type { OddsDaRodada, RodadaDoMembro } from '@titan/shared';
import Link from 'next/link';
import { oddsComValor } from './odds-com-valor';
import { multiplicador } from './rotulos';

/**
 * As odds em jogo na home do Titan Bet (D-80): só as opções com aposta confirmada
 * na rodada aberta, por mercado, da que mais paga para a que menos paga.
 *
 * Vazio é dito, não escondido: no começo da semana ainda não há slip confirmado, e
 * quem chega precisa saber que é vazio — não que a seção quebrou.
 */
export function OddsEmJogo({ cardapio, odds }: { cardapio: RodadaDoMembro; odds: OddsDaRodada }) {
  const mercados = oddsComValor(cardapio, odds);
  const rodada = `/interno/bet/${cardapio.roundId}`;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-fg text-lg font-semibold tracking-tight">Odds em jogo</h2>
        <Link href={rodada} className="text-accent text-sm hover:underline">
          Ver a rodada
        </Link>
      </div>

      {mercados.length === 0 ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Ainda não há apostas confirmadas nesta rodada.
        </p>
      ) : (
        <>
          <p className="text-fg-subtle text-xs">
            Só conta apostas confirmadas por um officer. O multiplicador é uma projeção — o retorno
            por 1 gold se a opção vencesse agora — e não é promessa. Em cada mercado, a que mais
            paga vem primeiro.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {mercados.map((m) => (
              <fieldset
                key={m.marketId}
                className="border-border flex min-w-0 flex-col gap-2 rounded-lg border p-4"
              >
                <legend className="text-fg px-1 text-sm font-semibold">{m.titulo}</legend>
                <ul className="flex flex-col gap-1">
                  {m.opcoes.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-fg flex min-w-0 flex-wrap items-center gap-x-2">
                        <span>{o.nome}</span>
                        {o.realm && <span className="text-fg-subtle text-xs">{o.realm}</span>}
                      </span>
                      <span className="text-fg-muted font-mono">
                        {multiplicador(o.multiplicador)}
                      </span>
                    </li>
                  ))}
                </ul>
              </fieldset>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
