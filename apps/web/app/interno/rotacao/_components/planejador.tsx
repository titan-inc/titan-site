'use client';

import {
  ROTATION_ROLES,
  motivoDaSugestao,
  type RotationPlayer,
  type RotationRole,
  type RotationView,
} from '@titan/shared';
import { useState, useTransition } from 'react';
import { API_URL } from '../../../../lib/config';

/** Cor por role. Só `pedra`, porque role não é estado nem alerta. */
const ROTULO_ROLE: Record<RotationRole, string> = {
  Tank: 'Tank',
  Heal: 'Heal',
  Melee: 'Melee',
  Ranged: 'Ranged',
};

/**
 * O planejador da semana.
 *
 * Client component porque tudo aqui é edição: travar, destravar, mudar quantos
 * sentam, tirar e pôr gente no banco. Cada escrita devolve a view inteira e
 * substitui o estado — assim a sugestão recalculada nunca fica meio velha.
 *
 * Escreve direto no Nest (`credentials: 'include'` leva o cookie), e não por
 * route handler do Next: a Regra 1 reserva route handler para o que é do
 * browser, e isto é regra de negócio com guard próprio.
 */
export function Planejador({ inicial }: { inicial: RotationView }) {
  const [view, setView] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, startTransition] = useTransition();

  // O banco que está na tela. Começa no plano salvo; sem plano salvo, na
  // sugestão — que é rascunho até alguém salvar.
  const [banco, setBanco] = useState<string[]>(
    inicial.saved?.characterIds ?? inicial.suggestion.map((s) => s.characterId),
  );
  const [seats, setSeats] = useState(inicial.seats);
  const [motivoTrava, setMotivoTrava] = useState('');
  const [aTravar, setATravar] = useState('');

  const porId = new Map(view.pool.map((p) => [p.characterId, p]));
  const disponiveis = view.pool.filter((p) => p.lock === null);
  const travados = view.pool.filter((p) => p.lock !== null);

  /** Toda escrita devolve a view; aplicar por inteiro evita estado meio velho. */
  function escrever(caminho: string, method: string, body?: unknown, depois?: () => void) {
    setErro(null);

    startTransition(async () => {
      try {
        const res = await fetch(`${API_URL}/internal/rotation${caminho}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const nova = (await res.json()) as RotationView;
        setView(nova);
        setSeats(nova.seats);
        setBanco(nova.saved?.characterIds ?? nova.suggestion.map((s) => s.characterId));
        depois?.();
      } catch {
        setErro('Não foi possível salvar');
      }
    });
  }

  function alternarRole(role: RotationRole) {
    const atual = new Set(view.roleLocks);
    if (atual.has(role)) atual.delete(role);
    else atual.add(role);
    escrever('/role-locks', 'PUT', { roles: [...atual] });
  }

  function travarJogador() {
    if (!aTravar || motivoTrava.trim().length < 3) return;
    escrever('/player-locks', 'POST', { characterId: aTravar, reason: motivoTrava }, () => {
      setATravar('');
      setMotivoTrava('');
    });
  }

  function salvarPlano() {
    escrever('/plan', 'PUT', { weekStart: view.weekStart, seats, characterIds: banco });
  }

  const salvo = view.saved;
  const mudou =
    salvo === null ||
    salvo.seats !== seats ||
    salvo.characterIds.length !== banco.length ||
    banco.some((id) => !salvo.characterIds.includes(id));

  return (
    <div className="flex flex-col gap-6">
      {view.teamStale && (
        // Decidir banco com time velho é sentar quem já saiu, ou não sentar
        // quem entrou. Avisar é melhor que esconder.
        <p className="border-danger/40 text-danger rounded-lg border border-dashed p-3 text-sm">
          O WoWAudit não respondeu — este time é o último dado bom, e pode estar desatualizado.
        </p>
      )}

      <section className="border-border rounded-lg border">
        <h2 className="border-border text-fg-subtle border-b px-4 py-2 font-mono text-xs tracking-widest uppercase">
          Travas
        </h2>

        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="text-fg-muted text-sm">Fora da rotação:</span>
            {ROTATION_ROLES.map((role) => (
              <label key={role} className="text-fg flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={view.roleLocks.includes(role)}
                  onChange={() => alternarRole(role)}
                  disabled={ocupado}
                  className="accent-accent"
                />
                {ROTULO_ROLE[role]}
              </label>
            ))}
          </div>

          <ul className="flex flex-col gap-2">
            {travados
              .filter((p) => p.lock?.kind === 'player')
              .map((p) => (
                <li key={p.characterId} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <span className="text-fg font-mono">
                    {p.name}
                    <span className="text-fg-subtle">-{p.realm}</span>
                  </span>
                  <span className="text-fg-muted">{p.lock?.reason}</span>
                  {/* Há quantas semanas a trava existe: é o que faz alguém
                      revisar um motivo que já deixou de valer. */}
                  {p.lock?.weeks !== null && p.lock?.weeks !== undefined && (
                    <span className="text-fg-subtle text-xs">
                      {p.lock.weeks === 0 ? 'travado esta semana' : `há ${p.lock.weeks} semana(s)`}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => escrever(`/player-locks/${p.lock?.id ?? ''}`, 'DELETE')}
                    disabled={ocupado}
                    className="text-fg-subtle hover:text-fg text-xs underline"
                  >
                    destravar
                  </button>
                </li>
              ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={aTravar}
              onChange={(e) => setATravar(e.target.value)}
              disabled={ocupado}
              aria-label="Jogador a travar"
              className="border-border bg-bg text-fg rounded-md border px-2 py-1 text-sm"
            >
              <option value="">travar jogador…</option>
              {disponiveis.map((p) => (
                <option key={p.characterId} value={p.characterId}>
                  {p.name}-{p.realm} ({p.role})
                </option>
              ))}
            </select>

            <input
              type="text"
              value={motivoTrava}
              onChange={(e) => setMotivoTrava(e.target.value)}
              placeholder="motivo (obrigatório)"
              aria-label="Motivo da trava"
              maxLength={200}
              disabled={ocupado}
              className="border-border bg-bg text-fg placeholder:text-fg-subtle w-64 rounded-md border px-2 py-1 text-sm"
            />

            <button
              type="button"
              onClick={travarJogador}
              disabled={ocupado || !aTravar || motivoTrava.trim().length < 3}
              className="border-border text-fg-muted hover:text-fg rounded-md border px-3 py-1 text-sm transition-colors disabled:opacity-40"
            >
              Travar
            </button>
          </div>
        </div>
      </section>

      <section className="border-border rounded-lg border">
        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
          <h2 className="text-fg-subtle font-mono text-xs tracking-widest uppercase">
            Banco da semana
          </h2>

          <label className="text-fg-muted flex items-center gap-2 text-sm">
            Sentar
            <input
              type="number"
              min={0}
              max={40}
              value={seats}
              onChange={(e) => setSeats(Number(e.target.value))}
              disabled={ocupado}
              className="border-border bg-bg text-fg w-16 rounded-md border px-2 py-1 text-sm tabular-nums"
            />
          </label>
        </div>

        <ul className="flex flex-col">
          {banco.length === 0 && (
            <li className="text-fg-muted px-4 py-3 text-sm">Ninguém no banco desta semana.</li>
          )}

          {banco.map((id) => {
            const p = porId.get(id);
            if (!p) return null;

            return (
              <li
                key={id}
                className="border-border/60 flex flex-wrap items-baseline gap-x-3 border-b px-4 py-2 text-sm last:border-0"
              >
                <span className="text-fg font-mono">
                  {p.name}
                  <span className="text-fg-subtle">-{p.realm}</span>
                </span>
                <span className="text-fg-subtle text-xs">{p.role}</span>
                {/* O motivo é o que o RL repete no Discord. Sem ele a sugestão
                    não é defensável, mesmo estando certa. */}
                <span className="text-pedra-lit text-xs">
                  {motivoDaSugestao(p.weeksSinceBench)}
                </span>
                <button
                  type="button"
                  onClick={() => setBanco(banco.filter((x) => x !== id))}
                  className="text-fg-subtle hover:text-fg ml-auto text-xs underline"
                >
                  tirar
                </button>
              </li>
            );
          })}
        </ul>

        <div className="border-border flex flex-wrap items-center gap-3 border-t px-4 py-3">
          <Adicionar
            candidatos={disponiveis.filter((p) => !banco.includes(p.characterId))}
            onAdd={(id) => setBanco([...banco, id])}
            disabled={ocupado}
          />

          <button
            type="button"
            onClick={salvarPlano}
            disabled={ocupado || !mudou}
            className="border-accent-deep bg-accent-soft text-accent hover:bg-accent-deep/30 rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-40"
          >
            {ocupado ? '…' : 'Salvar plano'}
          </button>

          {erro && <span className="text-danger text-sm">{erro}</span>}

          {!mudou && salvo && (
            <span className="text-fg-subtle text-xs">
              salvo por {salvo.savedBy} em {new Date(salvo.savedAt).toLocaleString('pt-BR')}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

/** Põe alguém no banco à mão — a sugestão é rascunho, não decisão. */
function Adicionar({
  candidatos,
  onAdd,
  disabled,
}: {
  candidatos: RotationPlayer[];
  onAdd: (id: string) => void;
  disabled: boolean;
}) {
  const [escolhido, setEscolhido] = useState('');

  return (
    <span className="flex items-center gap-2">
      <select
        value={escolhido}
        onChange={(e) => {
          setEscolhido(e.target.value);
          if (e.target.value) {
            onAdd(e.target.value);
            setEscolhido('');
          }
        }}
        disabled={disabled || candidatos.length === 0}
        aria-label="Adicionar ao banco"
        className="border-border bg-bg text-fg rounded-md border px-2 py-1 text-sm"
      >
        <option value="">adicionar ao banco…</option>
        {candidatos.map((p) => (
          <option key={p.characterId} value={p.characterId}>
            {p.name}-{p.realm} ({p.role}) — {motivoDaSugestao(p.weeksSinceBench)}
          </option>
        ))}
      </select>
    </span>
  );
}
