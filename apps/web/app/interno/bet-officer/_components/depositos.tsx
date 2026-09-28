'use client';

import { recusarDepositoSchema, type DepositoPendente } from '@titan/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Acao } from '../../../_components/ui/acao';
import { gold, personagem } from '../../bet/_components/rotulos';
import { Quando } from '../../mplus/_components/quando';
import { chamarOfficer, Erro } from './officer-api';

/**
 * Depósitos pendentes: o que conferir no Guild Bank (T-UI23; R-15, D-34).
 *
 * Sem as apostas — só dono, depositante e total. O officer confirma o próprio
 * depósito como qualquer outro (D-58); a tela só marca que é dele.
 */
export function Depositos({
  depositos,
  officerBattletag,
}: {
  depositos: DepositoPendente[];
  officerBattletag: string;
}) {
  const router = useRouter();
  const [motivos, setMotivos] = useState<Partial<Record<string, string>>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function confirmar(slipId: string) {
    setErro(null);
    startTransition(async () => {
      const r = await chamarOfficer(`/slips/${slipId}/confirmar`, { method: 'POST' });
      if (!r.ok) return setErro(r.motivo);
      router.refresh();
    });
  }

  function recusar(slipId: string) {
    setErro(null);
    const pedido = recusarDepositoSchema.safeParse({ motivo: motivos[slipId] ?? '' });
    if (!pedido.success) return setErro('Recusar exige o motivo (D-34).');
    startTransition(async () => {
      const r = await chamarOfficer(`/slips/${slipId}/recusar`, {
        method: 'POST',
        corpo: pedido.data,
      });
      if (!r.ok) return setErro(r.motivo);
      router.refresh();
    });
  }

  if (depositos.length === 0) {
    return <p className="text-fg-muted text-sm">Nenhum depósito pendente.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {depositos.map((d) => {
          const meu = d.ownerBattletag === officerBattletag;
          return (
            <li
              key={d.slipId}
              aria-label={`${d.ownerBattletag}: ${gold(d.expectedTotal)}`}
              className="border-border flex flex-col gap-2 rounded-lg border p-3"
            >
              <p className="text-fg text-sm">
                <strong>{d.ownerBattletag}</strong>
                {meu && <span className="text-bronze text-xs"> (seu)</span>}
              </p>
              <p className="text-fg-muted text-sm">
                {gold(d.expectedTotal)} por {personagem(d.depositCharacter)}, submetido{' '}
                <Quando iso={d.submittedAt} />
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <Acao variante="solida" onClick={() => confirmar(d.slipId)} disabled={pendente}>
                  Confirmar
                </Acao>
                <label className="text-fg-muted flex flex-col gap-1 text-xs">
                  Motivo da recusa
                  <input
                    className="border-border bg-surface text-fg rounded-md border px-3 py-2 text-sm"
                    value={motivos[d.slipId] ?? ''}
                    onChange={(e) => setMotivos((m) => ({ ...m, [d.slipId]: e.target.value }))}
                  />
                </label>
                <Acao variante="fantasma" onClick={() => recusar(d.slipId)} disabled={pendente}>
                  Recusar
                </Acao>
              </div>
            </li>
          );
        })}
      </ul>
      <Erro mensagem={erro} />
    </div>
  );
}
