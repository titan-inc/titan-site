import type { ResumoDaRodada } from '@titan/shared';
import Link from 'next/link';
import { Quando } from '../../mplus/_components/quando';
import { FASE } from './rotulos';

/**
 * A lista de rodadas, do membro e do Officer Panel (T-C01, T-C04).
 *
 * Cada rodada aparece pelo **cutoff** — o prazo das apostas, terça 12:00 no
 * reset. O `opensAt` é a sexta antes, o dia do job que abre a rodada (§9), e
 * não é o que quem aposta precisa saber (§39, B3).
 */
export function ListaDeRodadas({
  rodadas,
  base,
}: {
  rodadas: ResumoDaRodada[];
  base: '/interno/bet' | '/interno/bet-officer';
}) {
  if (rodadas.length === 0) {
    return (
      <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
        Nenhuma rodada ainda.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rodadas.map((r) => (
        <li key={r.roundId}>
          <Link
            href={`${base}/${r.roundId}`}
            className="border-border hover:bg-surface flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4 transition-colors"
          >
            <span className="text-fg text-sm font-medium">
              Apostas até <Quando iso={r.cutoffAt} />
            </span>
            <span className="text-fg-muted font-mono text-xs uppercase">{FASE[r.fase]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
