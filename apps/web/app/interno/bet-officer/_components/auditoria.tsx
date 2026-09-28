'use client';

import { declararSemRaidSchema, type AuditoriaCorrente } from '@titan/shared';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { Acao } from '../../../_components/ui/acao';
import { Quando } from '../../mplus/_components/quando';
import { chamarOfficer, Erro } from './officer-api';

type Fonte = AuditoriaCorrente['fontes'][number];

const SESSAO: Record<Fonte['session'], string> = { terca: 'Terça', quinta: 'Quinta' };

const STATUS: Record<AuditoriaCorrente['status'], string> = {
  aguardando_revisao: 'aguardando revisão',
  pronta: 'pronta para calcular',
  calculada: 'calculada',
  confirmada: 'confirmada',
};

/**
 * Auditar (T-UI25; D-30, D-60, D-63): a tentativa corrente, as fontes de cada
 * sessão com **todos** os `titanbet*` achados, e a declaração "não houve raid
 * oficial" — a única ação do officer sobre uma sessão sem report. Ausência
 * sozinha nunca resolve.
 */
export function Auditoria({
  roundId,
  auditoria,
  podeAuditar,
  auditavelDesde,
  somenteLeitura = false,
}: {
  roundId: string;
  auditoria: AuditoriaCorrente | null;
  /** Decidido pela API (D-73): a tela não compara relógio. */
  podeAuditar: boolean;
  /** Quinta 23:30 no fuso da guilda; `null` quando não há o que esperar. */
  auditavelDesde: string | null;
  /** Rodada cancelada (D-77): as fontes aparecem, nenhuma ação. */
  somenteLeitura?: boolean;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function auditar() {
    setErro(null);
    startTransition(async () => {
      const r = await chamarOfficer(`/rodadas/${roundId}/auditar`, { method: 'POST' });
      if (!r.ok) return setErro(r.motivo);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {auditoria && (
        <p className="text-fg-muted text-sm">
          Tentativa {auditoria.attempt}, {STATUS[auditoria.status]} — aberta por{' '}
          {auditoria.startedByBattletag}.
        </p>
      )}
      {auditoria?.fontes.map((f) => (
        <FonteDaSessao
          key={f.session}
          fonte={f}
          auditId={auditoria.auditId}
          aberta={auditoria.status === 'aguardando_revisao' && !somenteLeitura}
        />
      ))}
      {!podeAuditar && auditavelDesde !== null && (
        <p className="text-fg-muted text-sm">
          O Auditar abre depois da raid de quinta: <Quando iso={auditavelDesde} />.
        </p>
      )}
      {podeAuditar && !somenteLeitura && (
        <div>
          <Acao variante="fantasma" onClick={auditar} disabled={pendente}>
            {auditoria ? 'Auditar de novo' : 'Auditar'}
          </Acao>
        </div>
      )}
      <Erro mensagem={erro} />
    </div>
  );
}

function FonteDaSessao({
  fonte,
  auditId,
  aberta,
}: {
  fonte: Fonte;
  auditId: string;
  aberta: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function declarar() {
    setErro(null);
    const pedido = declararSemRaidSchema.safeParse({ motivo });
    if (!pedido.success) return setErro('Declarar sem raid exige o motivo (D-60).');
    startTransition(async () => {
      const r = await chamarOfficer(`/auditorias/${auditId}/fontes/${fonte.session}/sem-raid`, {
        method: 'POST',
        corpo: pedido.data,
      });
      if (!r.ok) return setErro(r.motivo);
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby={id}
      className="border-border flex flex-col gap-2 rounded-lg border p-3"
    >
      <h3 id={id} className="text-fg text-sm font-semibold">
        {SESSAO[fonte.session]}
      </h3>

      {fonte.resolution === 'automatica' && (
        <ul className="flex flex-col gap-1">
          {fonte.reports.map((r) => (
            <li key={r.code} className="text-fg-muted text-sm">
              {r.code} — {r.title} (revisão {r.revision})
            </li>
          ))}
        </ul>
      )}

      {fonte.resolution === 'sem_raid' && (
        <p className="text-fg-muted text-sm">
          Sem raid oficial: {fonte.motivoSemRaid} — declarado por {fonte.resolvedByBattletag}.
        </p>
      )}

      {fonte.resolution === 'ausente' && (
        <>
          <p className="text-fg-muted text-sm">
            Nenhum report titanbet* nesta sessão. A ausência não resolve sozinha.
          </p>
          {aberta && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-fg-muted flex flex-col gap-1 text-xs">
                Motivo
                <input
                  className="border-border bg-surface text-fg rounded-md border px-3 py-2 text-sm"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
              </label>
              <Acao variante="fantasma" onClick={declarar} disabled={pendente}>
                Declarar que não houve raid oficial
              </Acao>
            </div>
          )}
        </>
      )}
      <Erro mensagem={erro} />
    </section>
  );
}
