'use client';

import type { ResultadosDaAuditoria } from '@titan/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Acao } from '../../../_components/ui/acao';
import { gold, motivo, personagem, tituloDoMercado } from '../../bet/_components/rotulos';
import { chamarOfficer, Erro } from './officer-api';

type Mercado = ResultadosDaAuditoria['mercados'][number];

/**
 * Calcular, revisar e liquidar (T-UI26; §7.3, D-16, D-61).
 *
 * Liquidar lança prêmios, receita e resíduo no ledger e não se desfaz — por
 * isso a confirmação é em dois passos, e a tela diz que mexe em dinheiro.
 */
export function Resultados({
  resultados,
  auditId,
  bosses,
  encounters = {},
  podeCalcular,
}: {
  resultados: ResultadosDaAuditoria | null;
  auditId?: string;
  /** roundEncounterId → nome, para a Weekly (os resultados trazem ids). */
  bosses: Record<string, string>;
  /** marketId → nome do boss do mercado (a Weekly não tem). */
  encounters?: Record<string, string>;
  podeCalcular: boolean;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  const id = resultados?.auditId ?? auditId;

  function acao(caminho: string) {
    setErro(null);
    startTransition(async () => {
      const r = await chamarOfficer(caminho, { method: 'POST' });
      if (!r.ok) return setErro(r.motivo);
      setConfirmando(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {podeCalcular && id && (
        <div>
          <Acao
            variante="solida"
            onClick={() => acao(`/auditorias/${id}/calcular`)}
            disabled={pendente}
          >
            Calcular resultados
          </Acao>
        </div>
      )}

      {resultados?.mercados.map((m) => (
        <MercadoCalculado
          key={m.marketId}
          mercado={m}
          bosses={bosses}
          encounterName={encounters[m.marketId] ?? null}
        />
      ))}

      {resultados?.status === 'calculada' &&
        (confirmando ? (
          <div className="border-border flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-fg text-sm">
              Isto mexe em dinheiro: lança prêmios, receita e resíduo no ledger, e não se desfaz —
              correção depois é ajuste.
            </p>
            <div className="flex flex-wrap gap-3">
              <Acao
                variante="solida"
                onClick={() => acao(`/auditorias/${resultados.auditId}/confirmar`)}
                disabled={pendente}
              >
                Sim, liquidar
              </Acao>
              <Acao variante="fantasma" onClick={() => setConfirmando(false)}>
                Cancelar
              </Acao>
            </div>
          </div>
        ) : (
          <div>
            <Acao variante="solida" onClick={() => setConfirmando(true)}>
              Confirmar e liquidar
            </Acao>
          </div>
        ))}
      <Erro mensagem={erro} />
    </div>
  );
}

function MercadoCalculado({
  mercado: m,
  bosses,
  encounterName,
}: {
  mercado: Mercado;
  bosses: Record<string, string>;
  encounterName: string | null;
}) {
  return (
    <section className="border-border flex flex-col gap-1 rounded-lg border p-3">
      <h3 className="text-fg text-sm font-semibold">{tituloDoMercado(m.kind, encounterName)}</h3>
      {m.outcome === 'sem_vencedor' && (
        <p className="text-fg-muted text-sm">
          Sem vencedor: {motivo(m.motivo)}. O P vai para os mercados premiáveis; sem nenhum na
          rodada, volta a quem apostou neste mercado (D-74).
        </p>
      )}
      {m.outcome === 'anulado' && (
        <p className="text-fg-muted text-sm">Anulado: {motivo(m.motivo)}.</p>
      )}
      {m.outcome === 'vencedores' && (
        <ul className="flex flex-wrap gap-2">
          {m.kind === 'weekly_progression'
            ? m.bossesVencedores.map((b) => (
                <li key={b} className="text-fg text-sm">
                  {bosses[b] ?? b}
                </li>
              ))
            : m.vencedores.map((v) => (
                <li key={v.characterId} className="text-fg text-sm">
                  {personagem(v)}
                </li>
              ))}
        </ul>
      )}
      <p className="text-fg-subtle font-mono text-xs">
        V {gold(m.validPool)} · P {m.prizePool === null ? '—' : gold(m.prizePool)} · W{' '}
        {m.winningStake === null ? '—' : gold(m.winningStake)}
      </p>
    </section>
  );
}
