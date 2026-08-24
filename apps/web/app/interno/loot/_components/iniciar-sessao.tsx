'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { API_URL } from '../../../../lib/config';

/**
 * O loot master cola o export do addon e a sessão nasce montada.
 *
 * Colapsável, e fechado por padrão: durante a raid o que importa é a sessão que
 * está rolando, não o formulário de criar outra.
 *
 * A colagem vai **crua** para a API — quem interpreta o formato é o Nest, pela
 * Regra 1. Assim o front não sabe nada sobre o addon, e o dia em que ele mudar
 * de versão só um lado muda.
 */
export function IniciarSessao() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [paste, setPaste] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [problemas, setProblemas] = useState<Array<{ linha: number; motivo: string }>>([]);
  const [enviando, startTransition] = useTransition();

  function criar() {
    setErro(null);
    setProblemas([]);

    startTransition(async () => {
      try {
        const res = await fetch(`${API_URL}/internal/loot-sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ paste }),
        });

        const corpo: unknown = await res.json().catch(() => null);
        if (!res.ok) throw new Error(mensagem(corpo) ?? `HTTP ${res.status}`);

        const criada = corpo as {
          session: { id: string };
          problemas: Array<{ linha: number; motivo: string }>;
        };

        // Linha torta não derruba a colagem, e o loot master precisa ver o que
        // não entrou para acrescentar à mão. Esconder transformaria perda
        // silenciosa em surpresa na hora de entregar.
        if (criada.problemas.length > 0) {
          setProblemas(criada.problemas);
          router.refresh();
          return;
        }

        setPaste('');
        setAberto(false);
        router.push(`/interno/loot/sessao/${criada.session.id}`);
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível criar a sessão');
      }
    });
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="border-border hover:border-fg-subtle text-fg w-fit rounded-lg border px-4 py-2 text-sm"
      >
        Iniciar sessão
      </button>
    );
  }

  return (
    <section className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-fg text-sm font-medium">Iniciar sessão</h2>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="text-fg-muted hover:text-fg text-xs"
        >
          fechar
        </button>
      </div>

      <label htmlFor="paste" className="text-fg-muted text-xs">
        Cole aqui o que o addon copiou
      </label>
      <textarea
        id="paste"
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        rows={5}
        placeholder="TILC/1…"
        disabled={enviando}
        className="border-border bg-bg text-fg placeholder:text-fg-subtle rounded-md border px-3 py-2 font-mono text-xs"
      />

      <button
        type="button"
        onClick={criar}
        disabled={enviando || paste.trim() === ''}
        className="bg-fg text-bg w-fit rounded-md px-4 py-1.5 text-sm font-medium disabled:opacity-60"
      >
        {enviando ? 'Criando…' : 'Criar'}
      </button>

      {erro !== null && <p className="text-sm text-red-400">{erro}</p>}

      {problemas.length > 0 && (
        <div className="rounded-md border border-amber-500/40 p-3">
          <p className="text-sm text-amber-400">
            A sessão foi criada, mas {problemas.length} linha(s) não entraram:
          </p>
          <ul className="text-fg-muted mt-1 text-xs">
            {problemas.map((p) => (
              <li key={p.linha}>
                linha {p.linha}: {p.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** A mensagem que o Nest mandou, quando ele mandou uma. */
function mensagem(corpo: unknown): string | null {
  if (typeof corpo !== 'object' || corpo === null) return null;

  const message = (corpo as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}
