'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { API_URL } from '../../../../lib/config';

/**
 * Relê a noite do WoWAudit e do Warcraft Logs agora.
 *
 * O fluxo do raid leader é corrigir os signups no WoWAudit no dia seguinte —
 * quem esqueceu de responder, quem faltou, quem foi banco. Sem este botão a
 * correção só aparecia na rodada das 11h do outro dia.
 *
 * Chama o Nest direto, como a `NotaDoRl`: é regra de negócio com guard
 * próprio, não coisa de browser (Regra 1).
 */
export function AtualizarNoite({ raidId }: { raidId: number }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, startTransition] = useTransition();

  function atualizar() {
    setErro(null);

    startTransition(async () => {
      try {
        const res = await fetch(`${API_URL}/internal/attendance/nights/${raidId}/sync`, {
          method: 'POST',
          credentials: 'include',
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // A página é server component: refresh relê o relatório do banco.
        router.refresh();
      } catch {
        // A noite continua como estava. Dizer isso, em vez de recarregar a
        // tela velha como se fosse a nova.
        setErro('Não foi possível atualizar — o WoWAudit ou o Warcraft Logs não respondeu');
      }
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {erro && <span className="text-danger text-xs">{erro}</span>}

      <button
        type="button"
        onClick={atualizar}
        disabled={atualizando}
        title="Relê os signups do WoWAudit e o log desta noite. Use depois de corrigir a raid no WoWAudit."
        className="border-border text-fg-muted hover:text-fg rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-60"
      >
        {atualizando ? 'Atualizando…' : 'Atualizar do WoWAudit'}
      </button>
    </span>
  );
}
