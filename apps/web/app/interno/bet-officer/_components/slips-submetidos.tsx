'use client';

import {
  slipDoOfficerSchema,
  type SlipDoOfficer,
  type SlipsSubmetidos as ListaDeSlips,
} from '@titan/shared';
import { useState, useTransition } from 'react';
import { Acao } from '../../../_components/ui/acao';
import { gold, personagem, STATUS_DO_SLIP, tituloDoMercado } from '../../bet/_components/rotulos';
import { chamarOfficer, Erro } from './officer-api';

/**
 * Os slips submetidos da rodada, e o "ver slip" para disputa (T-UI24, D-57).
 *
 * A lista não traz aposta nenhuma. Abrir um slip é uma **ação explícita**:
 * cada abertura vira um `BetEvent` com o officer e o horário, e a tela diz
 * isso. O que se vê é só leitura — nenhuma ação altera o slip daqui.
 */
export function SlipsSubmetidos({ slips }: { slips: ListaDeSlips['slips'] }) {
  const [aberto, setAberto] = useState<SlipDoOfficer | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function ver(slipId: string) {
    setErro(null);
    startTransition(async () => {
      const r = await chamarOfficer(`/slips/${slipId}`);
      if (!r.ok) return setErro(r.motivo);
      const lido = slipDoOfficerSchema.safeParse(r.corpo);
      if (!lido.success) return setErro('Resposta inesperada da API.');
      setAberto(lido.data);
    });
  }

  if (slips.length === 0) {
    return <p className="text-fg-muted text-sm">Nenhum slip submetido.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {slips.map((s) => (
          <li
            key={s.slipId}
            className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
          >
            <span className="text-fg">
              {s.ownerBattletag} · {STATUS_DO_SLIP[s.status]} · {gold(s.expectedTotal)} por{' '}
              {personagem(s.depositCharacter)}
            </span>
            <Acao variante="fantasma" onClick={() => ver(s.slipId)} disabled={pendente}>
              Ver slip
            </Acao>
          </li>
        ))}
      </ul>
      <Erro mensagem={erro} />
      {aberto && <SlipAberto slip={aberto} />}
    </div>
  );
}

function SlipAberto({ slip }: { slip: SlipDoOfficer }) {
  return (
    <section className="border-border flex flex-col gap-2 rounded-lg border p-4">
      <p className="text-bronze text-xs">
        Este acesso fica registrado, com você e o horário (D-57).
      </p>
      <p className="text-fg text-sm">
        {slip.ownerBattletag} · {STATUS_DO_SLIP[slip.status]} · {gold(slip.expectedTotal)}
      </p>
      <p className="text-fg-muted text-sm">
        Elegibilidade: {personagem(slip.eligibilityCharacter)} · depositante:{' '}
        {personagem(slip.depositCharacter)}
      </p>
      <ul className="flex flex-col gap-1">
        {slip.apostas.map((a) => (
          <li key={a.marketId} className="text-fg text-sm">
            {tituloDoMercado(a.marketKind, null)}:{' '}
            {'alvo' in a ? personagem(a.alvo) : a.boss.encounterName} · {gold(a.stake)}
          </li>
        ))}
      </ul>
      {slip.rejectionReason && (
        <p className="text-fg-muted text-sm">Recusado: {slip.rejectionReason}</p>
      )}
    </section>
  );
}
