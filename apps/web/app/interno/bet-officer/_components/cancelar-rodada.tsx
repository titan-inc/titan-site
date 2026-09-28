'use client';

import { cancelarRodadaSchema, type RodadasDoOfficer } from '@titan/shared';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { Acao } from '../../../_components/ui/acao';
import { Quando } from '../../mplus/_components/quando';
import { chamarOfficer, Erro } from './officer-api';

type Cancelamento = RodadasDoOfficer['rodadas'][number]['cancelamento'];

/**
 * Cancelar a rodada (D-77): ação destrutiva, irreversível, com motivo. A API
 * decide se ainda pode (`podeCancelar`) e recusa depois do settlement; a tela
 * só pede a confirmação explícita. Cancelada, mostra quem, quando e por quê.
 */
export function CancelarRodada({
  roundId,
  podeCancelar,
  cancelamento,
}: {
  roundId: string;
  podeCancelar: boolean;
  cancelamento: Cancelamento;
}) {
  const router = useRouter();
  const id = useId();
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [entendi, setEntendi] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  // Uma chamada por vez: o `pendente` só desabilita o botão no render seguinte,
  // e um duplo clique chega antes dele (achado da validação no navegador).
  const enviando = useRef(false);

  if (cancelamento) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-red-400/60 p-4">
        <p className="text-sm font-semibold text-red-400">Rodada cancelada</p>
        <p className="text-fg text-sm">Motivo: {cancelamento.motivo}</p>
        <p className="text-fg-muted text-sm">
          Por {cancelamento.porBattletag} em <Quando iso={cancelamento.em} />.
        </p>
      </div>
    );
  }
  if (!podeCancelar) return null;

  const pedido = cancelarRodadaSchema.safeParse({ motivo });

  function cancelar() {
    if (enviando.current || !pedido.success || !entendi) return;
    enviando.current = true;
    setErro(null);
    startTransition(async () => {
      try {
        const r = await chamarOfficer(`/rodadas/${roundId}/cancelar`, {
          method: 'POST',
          corpo: pedido.data,
        });
        if (!r.ok) return setErro(r.motivo);
        router.refresh();
      } finally {
        enviando.current = false;
      }
    });
  }

  if (!confirmando) {
    return (
      <div>
        <Acao variante="perigo" onClick={() => setConfirmando(true)}>
          Cancelar rodada
        </Acao>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-red-400/60 p-4">
      <p className="text-fg text-sm">
        Cancelar é <strong>irreversível</strong>: a rodada não reabre, e todo slip ativo — rascunho,
        aguardando depósito ou válido — fica cancelado. Nada é apagado, e nenhum gold é lançado: a
        devolução de depósitos é feita pelos officers, fora do Titan Bet.
      </p>
      <label htmlFor={`${id}-motivo`} className="text-fg-muted flex flex-col gap-1 text-sm">
        Motivo do cancelamento
        <textarea
          id={`${id}-motivo`}
          className="border-border bg-surface text-fg rounded-md border px-3 py-2"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </label>
      <label className="text-fg flex items-center gap-2 text-sm">
        <input type="checkbox" checked={entendi} onChange={(e) => setEntendi(e.target.checked)} />
        Entendo que é irreversível
      </label>
      <div className="flex flex-wrap gap-3">
        <Acao
          variante="perigo"
          onClick={cancelar}
          disabled={pendente || !pedido.success || !entendi}
        >
          Confirmar cancelamento
        </Acao>
        <Acao variante="fantasma" onClick={() => setConfirmando(false)} disabled={pendente}>
          Voltar
        </Acao>
      </div>
      <Erro mensagem={erro} />
    </div>
  );
}
