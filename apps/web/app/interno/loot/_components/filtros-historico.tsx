'use client';

import { RAID_DIFFICULTIES, type LootHistoryFacets } from '@titan/shared';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { TODAS_AS_SEASONS } from './historico-url';

/** Os filtros que a tela põe na URL. */
interface Selecionado {
  season?: string;
  character?: string;
  encounterId?: string;
  difficulty?: string;
  slot?: string;
}

const DIFICULDADES = [
  { valor: RAID_DIFFICULTIES.NORMAL, rotulo: 'Normal' },
  { valor: RAID_DIFFICULTIES.HEROIC, rotulo: 'Heroic' },
  { valor: RAID_DIFFICULTIES.MYTHIC, rotulo: 'Mythic' },
] as const;

const CLASSE_SELECT =
  'border-border bg-surface text-fg focus-visible:outline-accent min-h-11 rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2';

/**
 * A barra de filtros do histórico.
 *
 * Todo filtro é `<select>` alimentado pelos facets, e não campo de texto: os
 * valores vêm com acento e realm colado (`Shrëwd-Area52`), e digitar isso à mão
 * não é filtro, é adivinhação — é a Regra 6 batendo na interface.
 *
 * Só aparece opção que **existe** no histórico daquela season, então nenhuma
 * escolha leva a uma tela vazia por engano.
 */
export function FiltrosHistorico({
  facets,
  selecionado,
}: {
  facets: LootHistoryFacets;
  selecionado: Selecionado;
}) {
  const router = useRouter();
  const [navegando, iniciarNavegacao] = useTransition();

  /**
   * Troca um filtro e volta para a primeira página.
   *
   * Sem o reset de página, filtrar estando na página 4 cairia numa página que o
   * novo filtro não tem, e a tela apareceria vazia com resultado existindo.
   */
  const trocar = (chave: keyof Selecionado, valor: string) => {
    const params = new URLSearchParams();

    for (const [k, v] of Object.entries({ ...selecionado, [chave]: valor })) {
      if (v !== undefined && v !== '') params.set(k, v);
    }

    iniciarNavegacao(() => router.push(`/interno/loot/historico?${params.toString()}`));
  };

  return (
    <div
      aria-busy={navegando}
      className={`flex flex-wrap items-end gap-3 ${navegando ? 'opacity-60' : ''}`}
    >
      <Campo id="season" rotulo="Season">
        <select
          id="season"
          className={CLASSE_SELECT}
          value={selecionado.season ?? ''}
          onChange={(e) => trocar('season', e.target.value)}
        >
          {facets.seasons.map((s) => (
            <option key={s.id ?? 'sem'} value={s.id === null ? '' : String(s.id)}>
              {s.name} ({s.total})
            </option>
          ))}
          <option value={TODAS_AS_SEASONS}>Todas as seasons</option>
        </select>
      </Campo>

      <Campo id="character" rotulo="Personagem">
        <select
          id="character"
          className={CLASSE_SELECT}
          value={selecionado.character ?? ''}
          onChange={(e) => trocar('character', e.target.value)}
        >
          <option value="">Todos</option>
          {facets.characters.map((c) => (
            <option key={c.value} value={c.value}>
              {c.name}-{c.realm} ({c.total})
            </option>
          ))}
        </select>
      </Campo>

      <Campo id="encounterId" rotulo="Boss">
        <select
          id="encounterId"
          className={CLASSE_SELECT}
          value={selecionado.encounterId ?? ''}
          onChange={(e) => trocar('encounterId', e.target.value)}
        >
          <option value="">Todos</option>
          {facets.bosses.map((b) => (
            <option key={b.encounterId} value={b.encounterId}>
              {b.name} ({b.total})
            </option>
          ))}
        </select>
      </Campo>

      <Campo id="difficulty" rotulo="Dificuldade">
        <select
          id="difficulty"
          className={CLASSE_SELECT}
          value={selecionado.difficulty ?? ''}
          onChange={(e) => trocar('difficulty', e.target.value)}
        >
          <option value="">Todas</option>
          {DIFICULDADES.map((d) => (
            <option key={d.valor} value={d.valor}>
              {d.rotulo}
            </option>
          ))}
        </select>
      </Campo>

      <Campo id="slot" rotulo="Slot">
        <select
          id="slot"
          className={CLASSE_SELECT}
          value={selecionado.slot ?? ''}
          onChange={(e) => trocar('slot', e.target.value)}
        >
          <option value="">Todos</option>
          {facets.slots.map((s) => (
            <option key={s.equipLoc} value={s.equipLoc}>
              {s.equipLoc} ({s.total})
            </option>
          ))}
        </select>
      </Campo>
    </div>
  );
}

function Campo({
  id,
  rotulo,
  children,
}: {
  id: string;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-fg-subtle font-mono text-xs tracking-widest uppercase">
        {rotulo}
      </label>
      {children}
    </div>
  );
}
