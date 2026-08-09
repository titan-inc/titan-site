'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import {
  killedInDifficulty,
  seasonLabel,
  type BossDifficultyProgress,
  type BossProgress,
  type RaidProgress,
  type RaidProgressReport,
} from '@titan/shared';

/**
 * Nome da dificuldade em português.
 *
 * O WCL devolve em inglês. Cai no valor original quando aparecer uma
 * dificuldade que não conhecemos — melhor "Raid Finder" que um rótulo vazio.
 */
const DIFICULDADE: Record<string, string> = {
  Mythic: 'Mítico',
  Heroic: 'Heroico',
  Normal: 'Normal',
  LFR: 'LFR',
};

/**
 * Fuso em que as datas são lidas.
 *
 * Fixo, e não o do ambiente, por dois motivos:
 *
 * - este é um client component, então renderiza no servidor **e** no browser.
 *   Servidor em UTC e browser em BRT produziriam HTML diferente e erro de
 *   hidratação, que não aparece em dev porque os dois são a mesma máquina.
 * - a raid começa 21h e vira a meia-noite UTC. Em UTC, uma kill às 21h30 de
 *   quinta aparece como sexta — a noite errada, para quem estava lá.
 *
 * É o horário da guilda, não a nacionalidade de ninguém: a raid tem um horário
 * marcado só, e é nele que a noite de raid acontece.
 */
const FUSO = 'America/Sao_Paulo';

function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: FUSO,
  });
}

function pct(v: number): string {
  return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/**
 * Uma célula: como o boss está naquela dificuldade.
 *
 * Três estados visualmente distintos, porque significam coisas diferentes:
 * morto (data), em progressão (melhor wipe) e nunca pullado ("—"). Mostrar
 * zero pulls como 0% faria "nunca fomos lá" parecer "wipamos com o boss full".
 */
function Celula({ estado }: { estado: BossDifficultyProgress | undefined }) {
  if (!estado) return <span className="text-fg-subtle">—</span>;

  if (estado.kills > 0 && estado.firstKillAt) {
    return (
      <span className="inline-flex items-baseline gap-1.5">
        <span className="text-accent">✓ {dataCurta(estado.firstKillAt)}</span>
        <span className="text-fg-subtle text-xs">
          {estado.pulls} {estado.pulls === 1 ? 'pull' : 'pulls'}
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-baseline gap-1.5">
      {/* Melhor wipe é % de vida restante: menor é mais perto do kill. */}
      <span className="text-fg-muted">
        {estado.bestPercent === null ? '—' : pct(estado.bestPercent)}
      </span>
      <span className="text-fg-subtle text-xs">
        {estado.pulls} {estado.pulls === 1 ? 'pull' : 'pulls'}
      </span>
    </span>
  );
}

function Raid({
  raid,
  difficulties,
}: {
  raid: RaidProgress;
  difficulties: RaidProgressReport['difficulties'];
}) {
  const semPull = raid.id === null;

  return (
    <section className="border-border overflow-hidden rounded-lg border">
      <header className="border-border bg-surface flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b px-4 py-3">
        <div>
          <h2 className={`font-medium ${semPull ? 'text-fg-muted' : 'text-fg'}`}>{raid.name}</h2>
          <p className="text-fg-subtle mt-0.5 font-mono text-xs tracking-wide">{raid.tier}</p>
        </div>

        {!semPull && (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {difficulties.map((d) => {
              const { killed, total } = killedInDifficulty(raid, d.id);
              const completa = killed === total;

              return (
                <span key={d.id} className="text-sm">
                  <span
                    className={`font-mono tabular-nums ${completa ? 'text-accent' : 'text-fg'}`}
                  >
                    {killed}/{total}
                  </span>
                  <span className="text-fg-subtle ml-1.5 text-xs">
                    {DIFICULDADE[d.name] ?? d.name}
                  </span>
                </span>
              );
            })}
          </div>
        )}
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="border-border text-fg-subtle border-b">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                Boss
              </th>
              {difficulties.map((d) => (
                <th key={d.id} scope="col" className="px-4 py-2.5 text-left font-medium">
                  {DIFICULDADE[d.name] ?? d.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {raid.bosses.map((boss: BossProgress) => (
              <tr key={boss.encounterId} className="border-border/60 border-b last:border-0">
                <td className={`px-4 py-2.5 ${semPull ? 'text-fg-muted' : 'text-fg'}`}>
                  {boss.name}
                </td>
                {difficulties.map((d) => (
                  <td key={d.id} className="px-4 py-2.5 font-mono tabular-nums">
                    <Celula estado={boss.byDifficulty.find((b) => b.difficulty === d.id)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RaidProgressTable({ report }: { report: RaidProgressReport }) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="season" className="text-fg-subtle text-sm">
          Season
        </label>
        <select
          id="season"
          defaultValue={report.season.id}
          disabled={pendente}
          onChange={(e) =>
            startTransition(() => router.push(`/interno/raid?season=${e.target.value}`))
          }
          className="border-border bg-surface text-fg rounded-md border px-3 py-1.5 text-sm"
        >
          {report.availableSeasons.map((s) => (
            <option key={s.id} value={s.id}>
              {seasonLabel(s)}
            </option>
          ))}
        </select>

        <span className="text-fg-subtle text-sm">
          {report.raids.filter((r) => r.id !== null).length} raids no tier
        </span>
      </div>

      {/* Dado velho rotulado como velho. Esconder que a atualização falhou é
          pior que mostrar o número desatualizado. */}
      {report.stale && (
        <p className="border-danger/40 bg-danger-soft text-fg-muted rounded-lg border px-4 py-3 text-sm">
          O Warcraft Logs não respondeu agora. Isto é a última leitura boa, de{' '}
          {new Date(report.fetchedAt).toLocaleString('pt-BR', { timeZone: FUSO })}.
        </p>
      )}

      {report.raids.length === 0 ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Nenhuma pull de raid registrada no Warcraft Logs nesta season.
        </p>
      ) : (
        report.raids.map((raid) => (
          <Raid key={raid.id ?? 'sem-pull'} raid={raid} difficulties={report.difficulties} />
        ))
      )}
    </>
  );
}
