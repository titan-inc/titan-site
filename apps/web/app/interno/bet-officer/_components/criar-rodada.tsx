'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { z } from 'zod';
import { Acao } from '../../../_components/ui/acao';
import { chamarOfficer, Erro } from './officer-api';

/** Cria a rodada da semana corrente e abre o painel dela (D-45). */
export function CriarRodada() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function criar() {
    setErro(null);
    startTransition(async () => {
      const r = await chamarOfficer('/rodadas', { method: 'POST' });
      if (!r.ok) return setErro(r.motivo);
      const criada = z.object({ roundId: z.string() }).safeParse(r.corpo);
      if (!criada.success) return setErro('Resposta inesperada da API.');
      router.push(`/interno/bet-officer/${criada.data.roundId}`);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Acao variante="solida" onClick={criar} disabled={pendente}>
          Criar rodada da semana
        </Acao>
      </div>
      <Erro mensagem={erro} />
    </div>
  );
}
