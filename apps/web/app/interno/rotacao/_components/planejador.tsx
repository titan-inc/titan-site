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
import { corDaClasse } from '../../../../lib/wow/classe';

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

  /**
   * Quem o RL pôs no banco à mão e não sai no recálculo.
   *
   * O caso: numa luta em que a classe rende mal, sentar aquela pessoa mesmo que
   * a conta não a escolhesse — ela é melhor aproveitada na semana seguinte.
   * Sem isto, o primeiro "Recalcular" apagaria a decisão.
   */
  const [fixos, setFixos] = useState<Set<string>>(
    () =>
      new Set(
        inicial.saved?.pinned ??
          inicial.suggestion.filter((s) => s.pinned).map((s) => s.characterId),
      ),
  );
  const [motivoTrava, setMotivoTrava] = useState('');
  const [aTravar, setATravar] = useState('');

  const porId = new Map(view.pool.map((p) => [p.characterId, p]));
  const disponiveis = view.pool.filter((p) => p.lock === null);
  const travados = view.pool.filter((p) => p.lock !== null);

  /**
   * Toda escrita devolve a view inteira, e ela substitui o pool e as travas.
   *
   * **Mas nunca refaz a lista do banco.** O oficial pode ter montado o banco à
   * mão, e travar um role no meio do caminho não pode apagar esse trabalho. A
   * única exceção é tirar quem a trava acabou de excluir — deixar alguém
   * travado dentro do banco seria a tela se contradizendo.
   *
   * Refazer a lista é o `recalcular()`, e é explícito de propósito.
   */
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

        const travados = new Set(
          nova.pool.filter((p) => p.lock !== null).map((p) => p.characterId),
        );
        setBanco((atual) => atual.filter((id) => !travados.has(id)));
        setFixos((atual) => new Set([...atual].filter((id) => !travados.has(id))));
        depois?.();
      } catch {
        setErro('Não foi possível salvar');
      }
    });
  }

  /**
   * Refaz a sugestão com o número de vagas que está na tela, **sem salvar**.
   *
   * Precisa ir ao servidor porque é lá que as vagas são distribuídas entre os
   * roles — mudar o número no cliente não teria como refazer essa conta.
   *
   * Existe por dois buracos que a tela tinha: mudar "Sentar" não fazia nada até
   * salvar (e salvava o número novo com a lista velha), e depois de salvar não
   * havia caminho de volta para um rascunho novo.
   */
  function recalcular() {
    setErro(null);

    startTransition(async () => {
      try {
        // `fixos` vai sempre, mesmo vazio: ausente significaria "usa o que está
        // salvo", e aqui o que vale é o que está na tela.
        const query = new URLSearchParams({ vagas: String(seats), fixos: [...fixos].join(',') });
        const res = await fetch(`${API_URL}/internal/rotation?${query}`, {
          credentials: 'include',
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const nova = (await res.json()) as RotationView;
        setView(nova);
        setBanco(nova.suggestion.map((s) => s.characterId));
      } catch {
        setErro('Não foi possível recalcular');
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

  /** Pôr à mão já é uma decisão: entra fixado, senão o recálculo apagaria. */
  function adicionarAoBanco(id: string) {
    setBanco((atual) => [...atual, id]);
    setFixos((atual) => new Set(atual).add(id));
  }

  /** Tirar solta junto — senão a pessoa voltaria no recálculo seguinte. */
  function tirarDoBanco(id: string) {
    setBanco((atual) => atual.filter((x) => x !== id));
    setFixos((atual) => {
      const novo = new Set(atual);
      novo.delete(id);
      return novo;
    });
  }

  function alternarFixo(id: string) {
    setFixos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function salvarPlano() {
    escrever('/plan', 'PUT', {
      weekStart: view.weekStart,
      seats,
      characterIds: banco,
      // Só faz sentido fixar quem está no banco; o Nest recusa o resto.
      pinned: banco.filter((id) => fixos.has(id)),
    });
  }

  const salvo = view.saved;
  const fixadosAgora = banco.filter((id) => fixos.has(id));
  const mudou =
    salvo === null ||
    salvo.seats !== seats ||
    salvo.characterIds.length !== banco.length ||
    banco.some((id) => !salvo.characterIds.includes(id)) ||
    // Soltar ou fixar alguém muda o plano mesmo com a mesma lista de gente:
    // é o que decide quem sobrevive ao próximo recálculo.
    salvo.pinned.length !== fixadosAgora.length ||
    fixadosAgora.some((id) => !salvo.pinned.includes(id));

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
                  <NomeDoJogador jogador={p} />
                  <span className="text-fg-subtle text-xs">{p.wowClass}</span>
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
                  {p.name}-{p.realm} ({p.wowClass} · {p.role})
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

          {/* Dizer de qual dos dois a lista é: sugestão e plano são coisas
              diferentes, e confundi-las é o que faz alguém achar que salvou. */}
          <span
            className={
              mudou
                ? 'text-pedra-lit rounded border border-current/30 px-2 py-0.5 text-xs'
                : 'text-accent rounded border border-current/30 px-2 py-0.5 text-xs'
            }
          >
            {mudou ? 'rascunho — não salvo' : 'plano salvo'}
          </span>

          <span className="flex items-center gap-2">
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

            {/* Mudar o número sozinho não refaz nada: as vagas são repartidas
                entre os roles no servidor. Daí o botão ser explícito. */}
            <button
              type="button"
              onClick={recalcular}
              disabled={ocupado}
              className="border-border text-fg-muted hover:text-fg rounded-md border px-3 py-1 text-sm transition-colors disabled:opacity-40"
            >
              Recalcular
            </button>
          </span>
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
                <NomeDoJogador jogador={p} />
                <span className="text-fg-subtle text-xs">
                  {p.wowClass} · {p.role}
                </span>
                {/* O motivo é o que o RL repete no Discord. Sem ele a sugestão
                    não é defensável, mesmo estando certa. */}
                <span className="text-pedra-lit text-xs">
                  {motivoDaSugestao(p.weeksSinceBench)}
                </span>

                {fixos.has(id) && (
                  <span className="text-accent rounded border border-current/30 px-1.5 py-0.5 text-xs">
                    fixado
                  </span>
                )}

                {/* Fixar é dizer "esta pessoa fica mesmo que a conta mude".
                    Soltar é o desfazer de quem foi posto ali por engano. */}
                <button
                  type="button"
                  onClick={() => alternarFixo(id)}
                  className="text-fg-subtle hover:text-fg ml-auto text-xs underline"
                >
                  {fixos.has(id) ? 'soltar' : 'fixar'}
                </button>

                <button
                  type="button"
                  onClick={() => tirarDoBanco(id)}
                  className="text-fg-subtle hover:text-fg text-xs underline"
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
            onAdd={adicionarAoBanco}
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

          {salvo && (
            <span className="text-fg-subtle text-xs">
              último salvo por {salvo.savedBy} em {new Date(salvo.savedAt).toLocaleString('pt-BR')}{' '}
              — {salvo.characterIds.length} no banco, {salvo.seats} vaga(s)
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Nome + realm, com o nome na cor da classe — é como o time reconhece as
 * pessoas no jogo, e deixa ver de relance quais classes estão no banco.
 *
 * A cor é reforço, não a informação: a classe também sai escrita ao lado, e
 * grafia desconhecida cai no texto normal em vez de adivinhar.
 */
function NomeDoJogador({ jogador }: { jogador: RotationPlayer }) {
  const cor = corDaClasse(jogador.wowClass);

  return (
    <span className="text-fg font-mono">
      <span style={cor ? { color: cor } : undefined}>{jogador.name}</span>
      <span className="text-fg-subtle">-{jogador.realm}</span>
    </span>
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
            {p.name}-{p.realm} ({p.wowClass} · {p.role}) — {motivoDaSugestao(p.weeksSinceBench)}
          </option>
        ))}
      </select>
    </span>
  );
}
