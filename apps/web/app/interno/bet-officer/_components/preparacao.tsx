'use client';

import {
  prepararRodadaSchema,
  type CatalogoDeRaid,
  type MercadoDeBoss,
  type PreparacaoDaRodada,
  type TrackDoEncounter,
} from '@titan/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Acao } from '../../../_components/ui/acao';
import { tituloDoMercado } from '../../bet/_components/rotulos';
import { chamarOfficer, Erro } from './officer-api';

const MERCADOS_DE_FARM: MercadoDeBoss[] = [
  'top_dps',
  'top_dps_parse',
  'top_hps',
  'top_hps_parse',
  'top_dispels',
  'first_death',
];

interface Incluido {
  track: TrackDoEncounter;
  mercados: MercadoDeBoss[];
}

/**
 * O que a preparação mostra (B2): por padrão, só o conteúdo atual da guilda — a
 * zone da atividade de raid real mais recente, que vem da API. De fora dele, só
 * os encounters já escolhidos, para ninguém perder de vista o que está na
 * semana. "Mostrar todas", ou nenhum conteúdo atual determinado: tudo.
 */
function zonasVisiveis(
  catalogo: CatalogoDeRaid,
  mostrarTodas: boolean,
  incluidos: Partial<Record<number, Incluido>>,
): CatalogoDeRaid['zonas'] {
  if (mostrarTodas || catalogo.zonaAtual === null) return catalogo.zonas;
  return catalogo.zonas.flatMap((z) => {
    if (z.zoneId === catalogo.zonaAtual) return [z];
    const escolhidos = z.encounters.filter((e) => incluidos[e.encounterId] !== undefined);
    return escolhidos.length > 0 ? [{ ...z, encounters: escolhidos }] : [];
  });
}

/** Boss em progressão só tem First Death (D-29) — o mesmo refine do contrato. */
function mercadosDoTrack(track: TrackDoEncounter): MercadoDeBoss[] {
  return track === 'farm' ? MERCADOS_DE_FARM : ['first_death'];
}

/**
 * Preparar a semana e dar o Ready (D-31, D-45; T-UI21, T-UI22).
 *
 * Salvar manda a semana inteira, como está agora — substitui a anterior. A
 * Weekly é só ligada ou desligada: as opções dela são os bosses de progressão
 * (D-54), e ninguém marca boss. Candidatos e bettors nunca são escolhidos aqui:
 * o Ready congela o snapshot sozinho (D-32, D-38).
 */
export function Preparacao({
  preparacao,
  catalogo,
  editavel,
}: {
  preparacao: PreparacaoDaRodada;
  catalogo: CatalogoDeRaid | null;
  editavel: boolean;
}) {
  const router = useRouter();
  const [weekly, setWeekly] = useState(preparacao.weekly !== null);
  const [mostrarTodas, setMostrarTodas] = useState(false);
  const [incluidos, setIncluidos] = useState<Partial<Record<number, Incluido>>>(() =>
    Object.fromEntries(
      preparacao.encounters.map((e) => [
        e.encounterId,
        { track: e.track, mercados: e.mercados.map((m) => m.kind) },
      ]),
    ),
  );
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function alternar(encounterId: number, incluir: boolean) {
    setIncluidos((atual) => ({
      ...atual,
      [encounterId]: incluir ? { track: 'farm', mercados: [] } : undefined,
    }));
  }

  function mudar(encounterId: number, mudanca: Partial<Incluido>) {
    setIncluidos((atual) => {
      const antes = atual[encounterId];
      if (!antes) return atual;
      const depois = { ...antes, ...mudanca };
      const validos = mercadosDoTrack(depois.track);
      return {
        ...atual,
        [encounterId]: { ...depois, mercados: depois.mercados.filter((m) => validos.includes(m)) },
      };
    });
  }

  function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setAviso(null);

    const ordem = (catalogo?.zonas ?? []).flatMap((z) => z.encounters.map((e) => e.encounterId));
    const pedido = prepararRodadaSchema.safeParse({
      weekly,
      encounters: ordem.flatMap((id) => {
        const i = incluidos[id];
        return i ? [{ encounterId: id, track: i.track, mercados: i.mercados }] : [];
      }),
    });
    if (!pedido.success) return setErro(pedido.error.issues[0]?.message ?? 'Preparação inválida.');

    startTransition(async () => {
      const r = await chamarOfficer(`/rodadas/${preparacao.roundId}/preparacao`, {
        method: 'PUT',
        corpo: pedido.data,
      });
      if (!r.ok) return setErro(r.motivo);
      setAviso('Preparação salva.');
      router.refresh();
    });
  }

  function darReady() {
    setErro(null);
    setAviso(null);
    startTransition(async () => {
      const r = await chamarOfficer(`/rodadas/${preparacao.roundId}/ready`, { method: 'POST' });
      if (!r.ok) return setErro(r.motivo);
      router.refresh();
    });
  }

  if (!editavel || !catalogo) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-fg-muted text-sm">
          Weekly Progression: {preparacao.weekly ? 'sim' : 'não'}
        </p>
        <ul className="flex flex-col gap-1">
          {preparacao.encounters.map((e) => (
            <li key={e.roundEncounterId} className="text-fg text-sm">
              {e.encounterName} ({e.track === 'farm' ? 'farm' : 'progressão'}):{' '}
              {e.mercados.map((m) => tituloDoMercado(m.kind, null)).join(', ') || 'sem mercado'}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form onSubmit={salvar} noValidate className="flex flex-col gap-4">
      <label className="text-fg flex items-center gap-2 text-sm">
        <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} />
        Weekly Progression nesta rodada
      </label>
      <p className="text-fg-subtle text-xs">
        As opções da Weekly são os bosses marcados como progressão — cada um com a própria odd.
      </p>

      {catalogo.zonaAtual === null ? (
        <p className="text-fg-muted text-sm">
          O conteúdo atual ainda não pôde ser determinado — nenhuma atividade de raid Mythic da
          guilda no Warcraft Logs. Mostrando o catálogo completo.
        </p>
      ) : (
        <div>
          <Acao variante="fantasma" onClick={() => setMostrarTodas((m) => !m)}>
            {mostrarTodas ? 'Mostrar só o conteúdo atual' : 'Mostrar todas'}
          </Acao>
        </div>
      )}

      {zonasVisiveis(catalogo, mostrarTodas, incluidos).map((zona) => (
        <div key={zona.zoneId} className="flex flex-col gap-3">
          <h3 className="text-fg-subtle font-mono text-xs tracking-widest uppercase">
            {zona.zoneName}
          </h3>
          {zona.encounters.map((e) => {
            const i = incluidos[e.encounterId];
            return (
              <fieldset
                key={e.encounterId}
                className="border-border flex flex-col gap-2 rounded-lg border p-3"
              >
                <legend className="text-fg px-1 text-sm font-semibold">{e.name}</legend>
                <label className="text-fg-muted flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={i !== undefined}
                    onChange={(ev) => alternar(e.encounterId, ev.target.checked)}
                  />
                  Incluir na semana
                </label>
                {i && (
                  <>
                    <label className="text-fg-muted flex items-center gap-2 text-sm">
                      Track
                      <select
                        className="border-border bg-surface text-fg rounded-md border px-2 py-1"
                        value={i.track}
                        onChange={(ev) =>
                          mudar(e.encounterId, { track: ev.target.value as TrackDoEncounter })
                        }
                      >
                        <option value="farm">Farm</option>
                        <option value="progressao">Progressão</option>
                      </select>
                    </label>
                    <div className="flex flex-wrap gap-3">
                      {mercadosDoTrack(i.track).map((m) => (
                        <label key={m} className="text-fg-muted flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={i.mercados.includes(m)}
                            onChange={(ev) =>
                              mudar(e.encounterId, {
                                mercados: ev.target.checked
                                  ? [...i.mercados, m]
                                  : i.mercados.filter((x) => x !== m),
                              })
                            }
                          />
                          {tituloDoMercado(m, null)}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </fieldset>
            );
          })}
        </div>
      ))}

      <div className="flex flex-wrap gap-3">
        <Acao variante="solida" type="submit" disabled={pendente}>
          Salvar preparação
        </Acao>
        <Acao variante="fantasma" onClick={darReady} disabled={pendente}>
          Dar Ready
        </Acao>
      </div>
      <Erro mensagem={erro} />
      {aviso && <p className="text-fg-muted text-sm">{aviso}</p>}
    </form>
  );
}
