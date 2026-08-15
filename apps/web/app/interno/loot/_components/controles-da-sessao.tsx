'use client';

import { proximosEstados, type LootSessionStatus } from '@titan/shared';
import { useState, useTransition } from 'react';
import { API_URL } from '../../../../lib/config';

/**
 * O que cada transição significa para quem está com a raid parada esperando.
 *
 * O rótulo é a ação, não o nome do estado: "fechar as respostas" diz o que vai
 * acontecer, `deliberando` não diz nada para quem não leu o modelo.
 */
const ACOES: Record<LootSessionStatus, { rotulo: string; aviso?: string }> = {
  rascunho: { rotulo: 'Voltar para rascunho' },
  aberta: { rotulo: 'Abrir para respostas' },
  deliberando: {
    rotulo: 'Fechar as respostas',
    aviso: 'Quem estava na sessão e não respondeu fica registrado como “não respondeu”.',
  },
  encerrada: {
    rotulo: 'Encerrar sessão',
    aviso: 'Encerrar é definitivo, e exige toda peça entregue.',
  },
};

/**
 * Os controles gerais da sessão. **Só conselho.**
 *
 * Quais botões existem vem de `proximosEstados()` no shared — a mesma função
 * que o serviço usa para decidir o que aceitar. Listar as transições aqui à mão
 * criaria dois lugares para divergirem, e o sintoma seria um botão que a API
 * recusa.
 */
export function ControlesDaSessao({
  sessionId,
  status,
  aoMudar,
}: {
  sessionId: string;
  status: LootSessionStatus;
  aoMudar: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, startTransition] = useTransition();

  const destinos = proximosEstados(status);

  function trocar(para: LootSessionStatus) {
    setErro(null);

    startTransition(async () => {
      try {
        const res = await fetch(`${API_URL}/internal/loot-sessions/${sessionId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status: para }),
        });

        if (!res.ok) {
          // A API diz quantas peças faltam ao recusar o encerramento. É
          // exatamente o que o loot master precisa saber para agir.
          const corpo: unknown = await res.json().catch(() => null);
          throw new Error(mensagem(corpo) ?? `HTTP ${res.status}`);
        }

        aoMudar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível mudar a sessão');
      }
    });
  }

  if (destinos.length === 0) {
    return <p className="text-fg-subtle text-xs">Esta sessão está encerrada.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {destinos.map((destino) => (
          <button
            key={destino}
            type="button"
            onClick={() => trocar(destino)}
            disabled={enviando}
            title={ACOES[destino].aviso}
            className="border-border hover:border-fg-subtle text-fg rounded-md border px-3 py-1.5 text-sm disabled:opacity-60"
          >
            {ACOES[destino].rotulo}
          </button>
        ))}
      </div>

      {erro !== null && <p className="text-sm text-red-400">{erro}</p>}
    </div>
  );
}

function mensagem(corpo: unknown): string | null {
  if (typeof corpo !== 'object' || corpo === null) return null;

  const message = (corpo as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}
