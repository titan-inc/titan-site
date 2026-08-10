import type { CSSProperties } from 'react';
import { lerConteudoRoster } from '../../../lib/roster/conteudo';
import { Rotulo } from '../ui/rotulo';
import { PlacaTripulante } from './placa-tripulante';

export async function Roster() {
  const conteudo = lerConteudoRoster();
  if (conteudo.membros.length === 0) return null;
  const total = conteudo.membros.length;
  const estilo = {
    '--colunas-md': Math.min(total, 3),
    '--colunas-lg': Math.min(total, 4),
    '--colunas-xl': Math.min(total, 5),
  } as CSSProperties;
  return (
    <section
      id="tripulacao"
      aria-labelledby="tripulacao-titulo"
      className="bg-deep overflow-hidden px-0 py-24 md:px-8 lg:py-40 xl:px-12"
    >
      <div className="mx-auto max-w-[1120px]">
        <div className="px-6 md:px-0">
          <Rotulo>Tripulação</Rotulo>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
            <div>
              <h2
                id="tripulacao-titulo"
                className="entalhe text-fg text-[30px] font-extrabold lg:text-[40px]"
              >
                Nosso time de <span className="letra-fel">raid</span>
              </h2>
              <p className="text-fg-muted mt-4 max-w-[48ch]">{conteudo.descricao}</p>
            </div>
            <p className="text-fg-subtle font-mono text-[11px] tracking-[0.14em] uppercase">
              {total} {total === 1 ? 'tripulante' : 'tripulantes'}
            </p>
          </div>
        </div>
        <ul
          tabIndex={0}
          aria-label="Tripulação, lista rolável"
          style={estilo}
          className="mt-12 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-5 md:grid md:[grid-template-columns:repeat(var(--colunas-md),minmax(0,1fr))] md:gap-5 md:overflow-visible md:px-0 lg:[grid-template-columns:repeat(var(--colunas-lg),minmax(0,1fr))] xl:[grid-template-columns:repeat(var(--colunas-xl),minmax(0,1fr))]"
        >
          {conteudo.membros.map((membro) => (
            <li
              key={membro.nome}
              className="w-[68vw] max-w-[280px] shrink-0 snap-start md:w-auto md:max-w-[240px]"
            >
              <PlacaTripulante membro={membro} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
