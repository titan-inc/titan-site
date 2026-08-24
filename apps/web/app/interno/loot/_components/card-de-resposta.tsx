'use client';

import { LIMITE_DA_NOTA, type LootSessionItemView } from '@titan/shared';
import { useEffect, useRef, useState, useTransition } from 'react';
import { API_URL } from '../../../../lib/config';
import { urlDoIcone } from './icone-do-item';

/**
 * O card de uma peça: onde a pessoa declara o que quer.
 *
 * `<dialog>` nativo com `showModal()`, e não uma `div` sobreposta: fechar no
 * Esc, prender o foco dentro e marcar o resto da página como inerte vêm de
 * graça, e são justamente as partes que uma sobreposição feita à mão erra.
 *
 * Fechar não perde nada — o elemento flutuante reabre o que ficou sem resposta,
 * e a linha do quadro reabre para trocar.
 */
export function CardDeResposta({
  sessionId,
  item,
  opcoes,
  aoFechar,
  aoResponder,
}: {
  sessionId: string;
  item: LootSessionItemView;
  opcoes: Array<{ slug: string; label: string }>;
  aoFechar: () => void;
  aoResponder: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [nota, setNota] = useState(item.minhaResposta?.note ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, startTransition] = useTransition();

  // `showModal()` é imperativo: o atributo `open` no JSX abre o dialog SEM
  // modalidade, e aí some o backdrop, o Esc e a trava de foco.
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  function responder(slug: string) {
    setErro(null);

    startTransition(async () => {
      try {
        const res = await fetch(
          `${API_URL}/internal/loot-sessions/${sessionId}/itens/${item.id}/resposta`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ responseOptionSlug: slug, note: nota }),
          },
        );

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        aoResponder();
        aoFechar();
      } catch {
        // Nunca fechar como se tivesse gravado: a pessoa confia que respondeu.
        setErro('Não foi possível responder. Tente de novo.');
      }
    });
  }

  return (
    <dialog
      ref={dialog}
      onClose={aoFechar}
      // Clicar fora fecha. O alvo do clique é o próprio `<dialog>` só quando
      // ele cai no backdrop — dentro, o alvo é algum filho.
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close();
      }}
      className="border-border bg-bg text-fg m-auto w-[min(28rem,92vw)] rounded-xl border p-0 backdrop:bg-black/60"
    >
      <div className="flex flex-col gap-4 p-5">
        <header className="flex items-start gap-3">
          {item.icon !== null && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urlDoIcone(item.icon)} alt="" width={40} height={40} className="rounded-md" />
          )}

          <div>
            <p className="font-medium">{item.name ?? `Item ${item.itemId}`}</p>
            {item.looterName !== null && (
              <p className="text-fg-subtle text-xs">lootado por {item.looterName}</p>
            )}
          </div>
        </header>

        <div>
          <label htmlFor="nota" className="text-fg-muted text-xs">
            Nota (opcional)
          </label>
          <textarea
            id="nota"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={LIMITE_DA_NOTA}
            rows={2}
            placeholder="tanko o segundo boss…"
            disabled={enviando}
            className="border-border bg-bg text-fg placeholder:text-fg-subtle mt-1 w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {opcoes.map((opcao) => (
            <button
              key={opcao.slug}
              type="button"
              onClick={() => responder(opcao.slug)}
              disabled={enviando}
              className={`rounded-md border px-3 py-1.5 text-sm disabled:opacity-60 ${
                item.minhaResposta?.responseOptionSlug === opcao.slug
                  ? 'border-fg bg-fg text-bg font-medium'
                  : 'border-border text-fg hover:border-fg-subtle'
              }`}
            >
              {opcao.label}
            </button>
          ))}
        </div>

        {item.minhaResposta !== null && (
          <p className="text-fg-subtle text-xs">
            Seu roll é <strong>{item.minhaResposta.roll}</strong> e não muda ao trocar a resposta.
          </p>
        )}

        {erro !== null && <p className="text-sm text-red-400">{erro}</p>}
      </div>
    </dialog>
  );
}
