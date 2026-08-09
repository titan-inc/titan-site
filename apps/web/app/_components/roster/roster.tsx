import type { CSSProperties } from 'react';
import { Rotulo } from '../ui/rotulo';
import { PlacaTripulante } from './placa-tripulante';

async function rosterDeDesenvolvimento() {
  if (process.env.NODE_ENV === 'production') return null;
  return (await import('../../../lib/mock/roster.mock')).ROSTER_MOCK[20];
}

export async function Roster() {
  const tripulantes = await rosterDeDesenvolvimento();
  if (!tripulantes)
    return (
      <section
        id="tripulacao"
        aria-labelledby="tripulacao-titulo"
        className="px-6 py-24 md:px-8 lg:py-40 xl:px-12"
      >
        <div className="mx-auto max-w-[1120px]">
          <Rotulo>Tripulação</Rotulo>
          <h2
            id="tripulacao-titulo"
            className="text-fg mt-6 text-[30px] font-extrabold lg:text-[40px]"
          >
            O time de raid
          </h2>
          <div className="chapa text-fg-muted mt-10 max-w-xl p-6">
            A lista da tripulação não respondeu agora. O time continua curado no WoWAudit; nenhum
            número foi inventado.
          </div>
        </div>
      </section>
    );
  const total = tripulantes.length;
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
                className="text-fg text-[30px] font-extrabold lg:text-[40px]"
              >
                O time de raid
              </h2>
              <p className="text-fg-muted mt-4 max-w-[48ch]">
                Quem senta na raid. A lista é curadoria do raid leader, não filtro de rank.
              </p>
            </div>
            <p className="text-fg-subtle font-mono text-[11px] tracking-[0.14em] uppercase">
              {total} tripulantes · dados de desenvolvimento
            </p>
          </div>
        </div>
        <ul
          tabIndex={0}
          aria-label="Tripulação, lista rolável"
          style={estilo}
          className="mt-12 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-5 md:grid md:[grid-template-columns:repeat(var(--colunas-md),minmax(0,1fr))] md:gap-5 md:overflow-visible md:px-0 lg:[grid-template-columns:repeat(var(--colunas-lg),minmax(0,1fr))] xl:[grid-template-columns:repeat(var(--colunas-xl),minmax(0,1fr))]"
        >
          {tripulantes.map((tripulante) => (
            <li
              key={`${tripulante.realm}/${tripulante.name}`}
              className="w-[68vw] max-w-[280px] shrink-0 snap-start md:w-auto md:max-w-[240px]"
            >
              <PlacaTripulante tripulante={tripulante} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
