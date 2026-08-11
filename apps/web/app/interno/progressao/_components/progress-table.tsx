'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { seasonLabel, type ProgressReport, type ProgressRow } from '@titan/shared';

type Coluna = 'personagem' | 'itemLevel' | 'itemLevelDelta' | 'keysDone' | 'keysInSeason';
type Direcao = 'asc' | 'desc';

const COLUNAS: Array<{ chave: Coluna; rotulo: string; numerica: boolean }> = [
  { chave: 'personagem', rotulo: 'Personagem', numerica: false },
  { chave: 'itemLevel', rotulo: 'ilvl', numerica: true },
  { chave: 'itemLevelDelta', rotulo: 'Δ semana', numerica: true },
  { chave: 'keysDone', rotulo: 'Chaves', numerica: true },
  { chave: 'keysInSeason', rotulo: 'Na season', numerica: true },
];

/** Duas casas, separador localizado. Ausência é "—", nunca zero. */
function num(v: number | null, casas: number): string {
  if (v === null) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Diferença com sinal explícito: `+2,10` lê melhor que `2,10` numa coluna de delta. */
function comSinal(v: number | null, casas: number): string {
  if (v === null) return '—';
  const texto = num(Math.abs(v), casas);
  if (v > 0) return `+${texto}`;
  if (v < 0) return `−${texto}`;
  return num(0, casas);
}

function corDoDelta(v: number | null): string {
  if (v === null || v === 0) return 'text-fg-subtle';
  return v > 0 ? 'text-accent' : 'text-fg-muted';
}

export function ProgressTable({ report }: { report: ProgressReport }) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [coluna, setColuna] = useState<Coluna>('itemLevel');
  const [direcao, setDirecao] = useState<Direcao>('desc');

  const ordenados = useMemo(() => {
    const fator = direcao === 'asc' ? 1 : -1;

    return [...report.rows].sort((a, b) => {
      if (coluna === 'personagem') {
        return `${a.name}-${a.realm}`.localeCompare(`${b.name}-${b.realm}`, 'pt-BR') * fator;
      }

      const va = a[coluna as keyof ProgressRow] as number | null;
      const vb = b[coluna as keyof ProgressRow] as number | null;

      // Sem dado vai sempre para o fim, nos dois sentidos. Tratar null como
      // zero colocaria quem não foi medido junto de quem não evoluiu.
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va - vb) * fator;
    });
  }, [report.rows, coluna, direcao]);

  function ordenarPor(chave: Coluna) {
    if (chave === coluna) {
      setDirecao((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setColuna(chave);
    setDirecao(chave === 'personagem' ? 'asc' : 'desc');
  }

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
            startTransition(() => router.push(`/interno/progressao?season=${e.target.value}`))
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
          Semana {report.weekInSeason} de {report.periodCount}
        </span>
      </div>

      {/* A season de M+ abre uma semana depois do patch. Sem este aviso, a
          coluna vazia é lida como site quebrado — e a anterior, se fosse
          mostrada, seria lida como progresso desta season. */}
      {!report.mythicPlusOpen && (
        <p className="border-border text-fg-muted rounded-lg border border-dashed px-4 py-3 text-sm">
          O M+ desta season ainda não abriu — ele começa uma semana depois do patch. Score e chaves
          na season aparecem vazios até lá, de propósito: o número que existe hoje é da season
          passada.
        </p>
      )}

      <div className="border-border bg-surface flex flex-wrap gap-x-8 gap-y-2 rounded-lg border p-4 text-sm">
        <div>
          <span className="text-fg-subtle">Média de ilvl do time </span>
          <span className="text-fg font-mono tabular-nums">{num(report.average.itemLevel, 2)}</span>
        </div>
        <div>
          <span className="text-fg-subtle">Média de chaves na semana </span>
          <span className="text-fg font-mono tabular-nums">{num(report.average.keysDone, 1)}</span>
        </div>
      </div>

      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="border-border text-fg-subtle border-b">
            <tr>
              {COLUNAS.map((c) => {
                const ativa = c.chave === coluna;
                return (
                  <th
                    key={c.chave}
                    scope="col"
                    aria-sort={ativa ? (direcao === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={c.numerica ? 'text-right' : 'text-left'}
                  >
                    <button
                      type="button"
                      onClick={() => ordenarPor(c.chave)}
                      className={`hover:text-fg w-full px-4 py-3 font-medium transition-colors ${
                        c.numerica ? 'text-right' : 'text-left'
                      } ${ativa ? 'text-fg' : ''}`}
                    >
                      {c.rotulo}
                      <span aria-hidden="true" className="text-fg-subtle ml-1.5 font-mono text-xs">
                        {ativa ? (direcao === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {ordenados.map((r) => (
              <tr key={`${r.realm}/${r.name}`} className="border-border/60 border-b last:border-0">
                <td className="text-fg px-4 py-2.5 font-mono">
                  {r.name}
                  <span className="text-fg-subtle">-{r.realm}</span>
                </td>

                <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                  <span className="text-fg">{num(r.itemLevel, 2)}</span>
                  {/* Distância para a média do time: o comparativo que o raid
                      leader pediu. Fica ao lado do valor, não em coluna
                      própria, para ler como contexto e não como nota. */}
                  <span className={`ml-2 text-xs ${corDoDelta(r.itemLevelVsAverage)}`}>
                    {comSinal(r.itemLevelVsAverage, 2)}
                  </span>
                </td>

                <td
                  className={`px-4 py-2.5 text-right font-mono tabular-nums ${corDoDelta(r.itemLevelDelta)}`}
                >
                  {comSinal(r.itemLevelDelta, 2)}
                </td>

                <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                  <span className="text-fg">{r.keysDone ?? '—'}</span>
                  <span className={`ml-2 text-xs ${corDoDelta(r.keysVsAverage)}`}>
                    {comSinal(r.keysVsAverage, 1)}
                  </span>
                </td>

                <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                  <span className="text-fg-muted">{r.keysInSeason ?? '—'}</span>
                  {/* Quantas foram no tempo. Esforço e resultado não são a
                      mesma coisa: 30 runs com 15 no tempo conta outra história
                      que 30 com 29. */}
                  {r.keysInSeasonTimed !== null && r.keysInSeason !== null && (
                    <span className="text-fg-subtle ml-2 text-xs">
                      {r.keysInSeasonTimed} no tempo
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
