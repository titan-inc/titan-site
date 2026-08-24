'use client';

import { useMemo, useState } from 'react';
import type { GuildRosterMember } from '@titan/shared';

type Coluna = 'personagem' | 'wowClass' | 'level' | 'rank' | 'battletag';
type Direcao = 'asc' | 'desc';

const COLUNAS: Array<{
  chave: Coluna;
  rotulo: string;
  numerica: boolean;
  /** Direção ao clicar pela primeira vez. */
  inicial: Direcao;
}> = [
  { chave: 'level', rotulo: 'Nível', numerica: true, inicial: 'desc' },
  { chave: 'wowClass', rotulo: 'Classe', numerica: false, inicial: 'asc' },
  { chave: 'personagem', rotulo: 'Personagem', numerica: false, inicial: 'asc' },
  // Rank 0 é o mais alto — Regra 4. Clicar a primeira vez mostra a liderança
  // no topo, não no fim.
  { chave: 'rank', rotulo: 'Rank', numerica: true, inicial: 'asc' },
  { chave: 'battletag', rotulo: 'BNet#', numerica: false, inicial: 'asc' },
];

/** Texto de ordenação de uma linha, para as colunas não numéricas. */
function textoDe(m: GuildRosterMember, chave: Coluna): string {
  if (chave === 'personagem') return `${m.name}-${m.realm}`;
  if (chave === 'wowClass') return m.wowClass ?? '';
  // battletag: sem dado vai para o fim — tratado antes de chegar aqui.
  return m.battletag ?? '';
}

export function GuildRosterTable({ members }: { members: GuildRosterMember[] }) {
  // Rank ascendente por padrão: a tabela abre espelhando a hierarquia da
  // guilda, com a liderança no topo.
  const [coluna, setColuna] = useState<Coluna>('rank');
  const [direcao, setDirecao] = useState<Direcao>('asc');

  const ordenados = useMemo(() => {
    const def = COLUNAS.find((c) => c.chave === coluna);
    const fator = direcao === 'asc' ? 1 : -1;

    return [...members].sort((a, b) => {
      if (def?.numerica) {
        const va = a[coluna as 'level' | 'rank'];
        const vb = b[coluna as 'level' | 'rank'];
        return (va - vb) * fator;
      }

      // Sem dado (classe ou BNet# ausente) sempre para o fim, nos dois
      // sentidos — mesma régua da tabela do time de raid: lacuna não é "menor".
      const ta = textoDe(a, coluna);
      const tb = textoDe(b, coluna);
      if (ta === '' && tb === '') return 0;
      if (ta === '') return 1;
      if (tb === '') return -1;

      return ta.localeCompare(tb, 'pt-BR') * fator;
    });
  }, [members, coluna, direcao]);

  function ordenarPor(chave: Coluna) {
    if (chave === coluna) {
      setDirecao((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setColuna(chave);
    setDirecao(COLUNAS.find((c) => c.chave === chave)?.inicial ?? 'asc');
  }

  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[34rem] text-sm">
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
          {ordenados.map((m) => (
            // Nome + realm é a identidade — nome sozinho colide. Ver Regra 6.
            <tr key={`${m.realm}/${m.name}`} className="border-border/60 border-b last:border-0">
              <td className="text-fg px-4 py-2.5 text-right font-mono tabular-nums">{m.level}</td>
              <td className="text-fg-muted px-4 py-2.5">{m.wowClass ?? '—'}</td>
              <td className="text-fg px-4 py-2.5 font-mono">
                {m.name}
                <span className="text-fg-subtle">-{m.realm}</span>
              </td>
              <td className="text-fg px-4 py-2.5 text-right font-mono tabular-nums">{m.rank}</td>
              <td className="text-fg-muted px-4 py-2.5 font-mono">{m.battletag ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
