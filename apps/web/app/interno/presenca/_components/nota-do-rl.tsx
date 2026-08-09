'use client';

import { useState, useTransition } from 'react';
import { API_URL } from '../../../../lib/config';

/**
 * Campo de anotação do raid leader.
 *
 * Só aparece para oficial e só em "Não Raidou" — é o único estado que o log não
 * desambigua. O que fica guardado é este texto, nunca a inferência do sistema.
 *
 * Escreve direto na API do Nest (`credentials: 'include'` leva o cookie), e não
 * por route handler do Next: a Regra 1 reserva route handler para o que é
 * genuinamente do browser, e isto é regra de negócio com guard próprio.
 */
export function NotaDoRl({ id, inicial }: { id: string; inicial: string | null }) {
  const [texto, setTexto] = useState(inicial ?? '');
  const [salvo, setSalvo] = useState<string | null>(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, startTransition] = useTransition();

  const mudou = texto.trim() !== (salvo ?? '');

  function salvar() {
    setErro(null);

    startTransition(async () => {
      try {
        const res = await fetch(`${API_URL}/internal/attendance/${id}/note`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ note: texto }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSalvo(texto.trim() === '' ? null : texto.trim());
      } catch {
        // Nunca mostrar como salvo o que não foi: o RL confia que anotou.
        setErro('Não foi possível salvar');
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input
        type="text"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={500}
        placeholder="motivo…"
        aria-label="Motivo de não ter raidado"
        disabled={salvando}
        className="border-border bg-bg text-fg placeholder:text-fg-subtle w-44 rounded-md border px-2 py-1 text-xs"
      />

      {mudou && (
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className="border-border text-fg-muted hover:text-fg rounded-md border px-2 py-1 text-xs transition-colors"
        >
          {salvando ? '…' : 'Salvar'}
        </button>
      )}

      {/* Aqui `danger` é o certo: falhar ao salvar é erro de verdade, e o RL
          precisa saber que o que ele escreveu não foi guardado. */}
      {erro && <span className="text-danger text-xs">{erro}</span>}
    </span>
  );
}
