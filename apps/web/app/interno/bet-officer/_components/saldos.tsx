'use client';

import {
  ajustarSchema,
  lancamentosDoSlipSchema,
  type LancamentosDoSlip,
  type SaldosDaRodada,
} from '@titan/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Acao } from '../../../_components/ui/acao';
import { gold, TIPO_DE_LANCAMENTO } from '../../bet/_components/rotulos';
import { chamarOfficer, Erro } from './officer-api';

type Saldo = SaldosDaRodada['saldos'][number];

/**
 * Saldos, pagar e ajustar (T-UI27; §16.6, D-11).
 *
 * Pagar lança o saldo inteiro. Nada é reescrito: corrigir é um `ajuste` com
 * sinal, motivo e o lançamento que ele corrige — escolhido da lista do ledger
 * do slip (T-C06).
 */
export function Saldos({ saldos }: { saldos: Saldo[] }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ajustando, setAjustando] = useState<{
    slipId: string;
    lancamentos: LancamentosDoSlip['lancamentos'];
  } | null>(null);
  const [pendente, startTransition] = useTransition();

  function pagar(slipId: string) {
    setErro(null);
    startTransition(async () => {
      const r = await chamarOfficer(`/slips/${slipId}/pagar`, { method: 'POST' });
      if (!r.ok) return setErro(r.motivo);
      router.refresh();
    });
  }

  /** Abre o ajuste com a lista do ledger do slip (T-C06): é dela que sai o lançamento corrigido. */
  function abrirAjuste(slipId: string) {
    setErro(null);
    startTransition(async () => {
      const r = await chamarOfficer(`/slips/${slipId}/lancamentos`);
      if (!r.ok) return setErro(r.motivo);
      const lido = lancamentosDoSlipSchema.safeParse(r.corpo);
      if (!lido.success) return setErro('Resposta inesperada da API.');
      setAjustando({ slipId, lancamentos: lido.data.lancamentos });
    });
  }

  if (saldos.length === 0) return <p className="text-fg-muted text-sm">Nenhum saldo na rodada.</p>;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {saldos.map((s) => (
          <li key={s.slipId} className="border-border flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-fg text-sm">
              {s.ownerBattletag}: devido {gold(s.devido)} · pago {gold(s.pago)}
            </p>
            <div className="flex flex-wrap gap-3">
              {s.devido > 0 && (
                <Acao variante="solida" onClick={() => pagar(s.slipId)} disabled={pendente}>
                  Pagar {gold(s.devido)}
                </Acao>
              )}
              <Acao variante="fantasma" onClick={() => abrirAjuste(s.slipId)} disabled={pendente}>
                Ajustar
              </Acao>
            </div>
            {ajustando?.slipId === s.slipId && (
              <Ajuste
                slipId={s.slipId}
                lancamentos={ajustando.lancamentos}
                onLancado={() => setAjustando(null)}
              />
            )}
          </li>
        ))}
      </ul>
      <Erro mensagem={erro} />
    </div>
  );
}

function Ajuste({
  slipId,
  lancamentos,
  onLancado,
}: {
  slipId: string;
  lancamentos: LancamentosDoSlip['lancamentos'];
  /** Lançado, o formulário fecha: a lista dele já não inclui o ajuste novo. */
  onLancado: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    entryId: lancamentos[0]?.entryId ?? '',
    amount: '',
    reason: '',
  });
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function lancar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    const pedido = ajustarSchema.safeParse({
      amount: Number(form.amount),
      reason: form.reason,
      correctsEntryId: form.entryId,
    });
    if (!pedido.success) {
      return setErro(
        'O ajuste precisa de valor diferente de zero, motivo e o lançamento que corrige.',
      );
    }
    startTransition(async () => {
      const r = await chamarOfficer(`/slips/${slipId}/ajustes`, {
        method: 'POST',
        corpo: pedido.data,
      });
      if (!r.ok) return setErro(r.motivo);
      onLancado();
      router.refresh();
    });
  }

  return (
    <form onSubmit={lancar} noValidate className="flex flex-wrap items-end gap-3">
      <label className="text-fg-muted flex flex-col gap-1 text-xs">
        Lançamento corrigido
        <select
          className="border-border bg-surface text-fg rounded-md border px-2 py-2 text-sm"
          value={form.entryId}
          onChange={(e) => setForm((f) => ({ ...f, entryId: e.target.value }))}
        >
          {lancamentos.map((l) => (
            <option key={l.entryId} value={l.entryId}>
              #{l.entryId} {TIPO_DE_LANCAMENTO[l.kind]} {gold(l.amount)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-fg-muted flex flex-col gap-1 text-xs">
        Valor (gold, com sinal)
        <input
          className="border-border bg-surface text-fg w-32 rounded-md border px-3 py-2 text-sm"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
        />
      </label>
      <label className="text-fg-muted flex flex-col gap-1 text-xs">
        Motivo do ajuste
        <input
          className="border-border bg-surface text-fg rounded-md border px-3 py-2 text-sm"
          value={form.reason}
          onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
        />
      </label>
      <Acao variante="solida" type="submit" disabled={pendente}>
        Lançar ajuste
      </Acao>
      <Erro mensagem={erro} />
    </form>
  );
}
