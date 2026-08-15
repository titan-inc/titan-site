'use client';

import type { CharacterRef, Participante } from '@titan/shared';
import { useState, useTransition } from 'react';
import { API_URL } from '../../../../lib/config';

/**
 * Entrar na sessão, com o personagem daquela noite.
 *
 * Ato explícito, e não consequência de abrir a tela: quem abre a sessão pelo
 * celular durante o jantar não está na raid, e entrar por engano colocaria a
 * pessoa na lista de candidatos à peça de alguém (TIT-126).
 *
 * O select vem do melhor rank para o pior, então o representante da conta já
 * aparece selecionado — quem raida no main não escolhe nada.
 *
 * Escreve direto na API do Nest com `credentials: 'include'`, como a nota do RL
 * em `/interno/presenca`: a Regra 1 reserva route handler do Next para o que é
 * genuinamente do browser, e isto é regra de negócio com guard próprio.
 */
export function EntrarNaSessao({
  sessionId,
  personagens,
  participacao,
  encerrada,
  aoEntrar,
}: {
  sessionId: string;
  personagens: CharacterRef[];
  participacao: Participante | null;
  encerrada: boolean;
  aoEntrar: () => void;
}) {
  const [escolhido, setEscolhido] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [trocando, setTrocando] = useState(false);
  const [enviando, startTransition] = useTransition();

  const mostrarForm = participacao === null || trocando;

  function entrar() {
    const personagem = personagens[escolhido];
    if (!personagem) return;

    setErro(null);

    startTransition(async () => {
      try {
        const res = await fetch(`${API_URL}/internal/loot-sessions/${sessionId}/entrar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            characterName: personagem.name,
            characterRealm: personagem.realm,
          }),
        });

        if (!res.ok) {
          // A API recusa trocar de personagem depois de responder, e a mensagem
          // dela diz o caminho. Trocar por um texto genérico esconderia isso.
          const corpo: unknown = await res.json().catch(() => null);
          throw new Error(mensagemDaApi(corpo) ?? `HTTP ${res.status}`);
        }

        setTrocando(false);
        aoEntrar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível entrar');
      }
    });
  }

  if (encerrada && participacao === null) {
    return (
      <p className="border-border text-fg-muted rounded-lg border border-dashed p-4 text-sm">
        Esta sessão já encerrou.
      </p>
    );
  }

  if (personagens.length === 0) {
    return (
      <p className="border-border text-fg-muted rounded-lg border border-dashed p-4 text-sm">
        Sua conta não tem personagem no roster da guilda.
      </p>
    );
  }

  return (
    <div className="border-border flex flex-wrap items-center gap-3 rounded-lg border p-4">
      {mostrarForm ? (
        <>
          <label htmlFor="personagem" className="text-fg-muted text-sm">
            Entrar como
          </label>

          <select
            id="personagem"
            value={escolhido}
            onChange={(e) => setEscolhido(Number(e.target.value))}
            disabled={enviando}
            className="border-border bg-bg text-fg rounded-md border px-3 py-1.5 text-sm"
          >
            {personagens.map((p, i) => (
              <option key={`${p.name}-${p.realm}`} value={i}>
                {p.name} — {p.realm}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={entrar}
            disabled={enviando}
            className="bg-fg text-bg rounded-md px-4 py-1.5 text-sm font-medium disabled:opacity-60"
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>

          {trocando && (
            <button
              type="button"
              onClick={() => setTrocando(false)}
              className="text-fg-muted hover:text-fg text-sm"
            >
              cancelar
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-fg text-sm">
            Você está na sessão como <strong>{participacao.name}</strong>
          </p>

          {!encerrada && (
            <button
              type="button"
              onClick={() => setTrocando(true)}
              className="text-fg-muted hover:text-fg text-sm underline"
            >
              trocar de personagem
            </button>
          )}
        </>
      )}

      {erro !== null && <p className="w-full text-sm text-red-400">{erro}</p>}
    </div>
  );
}

/** A mensagem que o Nest mandou, quando ele mandou uma. */
function mensagemDaApi(corpo: unknown): string | null {
  if (typeof corpo !== 'object' || corpo === null) return null;

  const message = (corpo as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}
