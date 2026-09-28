'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { z } from 'zod';
import { Acao } from '../../../_components/ui/acao';
import { chamarOfficer, Erro } from './officer-api';

/**
 * Publicar o Round Closing Report (T-UI28; D-21, D-48). Republicar é versão
 * nova; nenhuma versão muda depois de publicada.
 */
export function PublicarClosing({ roundId }: { roundId: string }) {
  const router = useRouter();
  const [versao, setVersao] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function publicar() {
    setErro(null);
    startTransition(async () => {
      const r = await chamarOfficer(`/rodadas/${roundId}/closing`, { method: 'POST' });
      if (!r.ok) return setErro(r.motivo);
      const publicado = z.object({ version: z.number().int() }).safeParse(r.corpo);
      if (!publicado.success) return setErro('Resposta inesperada da API.');
      setVersao(publicado.data.version);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Acao variante="solida" onClick={publicar} disabled={pendente}>
          Publicar Closing Report
        </Acao>
      </div>
      {versao !== null && <p className="text-fg-muted text-sm">Versão {versao} publicada.</p>}
      <Erro mensagem={erro} />
    </div>
  );
}
