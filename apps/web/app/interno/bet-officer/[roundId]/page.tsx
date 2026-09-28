import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  getAuditoriaOfficer,
  getCatalogoOfficer,
  getDepositosOfficer,
  getPreparacaoOfficer,
  getResultadosOfficer,
  getRodadasOfficer,
  getSaldosOfficer,
  getSessionUser,
  getSlipsOfficer,
} from '../../../../lib/api';
import { FASE } from '../../bet/_components/rotulos';
import { destinoDoPainel } from '../_components/acesso';
import { Auditoria } from '../_components/auditoria';
import { CancelarRodada } from '../_components/cancelar-rodada';
import { Depositos } from '../_components/depositos';
import { DepositosADevolver } from '../_components/depositos-a-devolver';
import { Preparacao } from '../_components/preparacao';
import { PublicarClosing } from '../_components/publicar-closing';
import { Resultados } from '../_components/resultados';
import { Saldos } from '../_components/saldos';
import { SlipsSubmetidos } from '../_components/slips-submetidos';

export const metadata = { title: 'Rodada (officer) — Titan Inc' };

const FASES_DO_CLOSING = new Set(['SETTLED', 'CLOSED']);

/**
 * Uma rodada no Officer Panel, na ordem do ciclo: preparação e Ready,
 * depósitos, slips ("ver slip"), Auditar, resultados e liquidação, saldos e o
 * Closing Report. Cada seção lê no servidor e escreve pelo client component,
 * direto no Nest; o `OfficerGuard` decide cada chamada (Regra 5).
 */
export default async function RodadaOfficerPage({
  params,
}: {
  params: Promise<{ roundId: string }>;
}) {
  const { roundId } = await params;
  const user = await getSessionUser();
  const destino = destinoDoPainel(user);
  if (destino || !user) redirect(destino ?? '/?erro=sessao');

  const [rodadas, preparacao, depositos, slips, auditoria, saldos] = await Promise.all([
    getRodadasOfficer(),
    getPreparacaoOfficer(roundId),
    getDepositosOfficer(roundId),
    getSlipsOfficer(roundId),
    getAuditoriaOfficer(roundId),
    getSaldosOfficer(roundId),
  ]);
  if (rodadas.tipo === 'proibido') redirect('/interno');

  const resumo =
    rodadas.tipo === 'ok' ? rodadas.dados.rodadas.find((r) => r.roundId === roundId) : undefined;
  if (!resumo || preparacao.tipo !== 'ok') {
    return (
      <main className="flex flex-1 flex-col gap-6">
        <Cabecalho />
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          {resumo === undefined && rodadas.tipo === 'ok'
            ? 'Esta rodada não existe.'
            : 'Não foi possível carregar a rodada agora.'}
        </p>
      </main>
    );
  }

  const fase = resumo.fase;
  const emPreparacao = fase === 'PREPARATION';
  // Cancelada (D-77): tudo fica visível, nenhuma ação que mude a rodada.
  const cancelada = fase === 'CANCELLED';
  const catalogo = emPreparacao ? await getCatalogoOfficer() : null;
  const corrente = auditoria.tipo === 'ok' ? auditoria.dados : null;
  const resultados =
    corrente && (corrente.status === 'calculada' || corrente.status === 'confirmada')
      ? await getResultadosOfficer(corrente.auditId)
      : null;
  const bosses = Object.fromEntries(
    preparacao.dados.encounters.map((e) => [e.roundEncounterId, e.encounterName]),
  );
  // marketId → boss, para cada resultado dizer de que boss é (§39, B8).
  const encounters = Object.fromEntries(
    preparacao.dados.encounters.flatMap((e) =>
      e.mercados.map((m) => [m.marketId, e.encounterName]),
    ),
  );

  return (
    <main className="flex flex-1 flex-col gap-10">
      <Cabecalho fase={FASE[fase]} />

      {(resumo.podeCancelar || resumo.cancelamento) && (
        <Secao titulo="Cancelamento">
          <CancelarRodada
            roundId={roundId}
            podeCancelar={resumo.podeCancelar}
            cancelamento={resumo.cancelamento}
          />
        </Secao>
      )}

      {cancelada && (
        <Secao titulo="Depósitos a devolver fora do Titan Bet">
          {slips.tipo === 'ok' ? (
            <DepositosADevolver slips={slips.dados.slips} />
          ) : (
            <Indisponivel />
          )}
        </Secao>
      )}

      <Secao titulo="Preparação e Ready">
        <Preparacao
          preparacao={preparacao.dados}
          catalogo={catalogo?.tipo === 'ok' ? catalogo.dados : null}
          editavel={emPreparacao}
        />
      </Secao>

      <Secao titulo="Depósitos pendentes">
        {depositos.tipo === 'ok' ? (
          <Depositos depositos={depositos.dados.depositos} officerBattletag={user.battletag} />
        ) : (
          <Indisponivel />
        )}
      </Secao>

      <Secao titulo="Slips submetidos">
        {slips.tipo === 'ok' ? <SlipsSubmetidos slips={slips.dados.slips} /> : <Indisponivel />}
      </Secao>

      <Secao titulo="Auditar">
        <Auditoria
          roundId={roundId}
          auditoria={corrente}
          podeAuditar={resumo.podeAuditar}
          somenteLeitura={cancelada}
          // Só há o que esperar com as apostas fechadas e nada auditado ainda.
          auditavelDesde={fase === 'BETTING_CLOSED' ? resumo.auditavelDesde : null}
        />
      </Secao>

      {corrente && (
        <Secao titulo="Resultados e liquidação">
          <Resultados
            resultados={resultados?.tipo === 'ok' ? resultados.dados : null}
            auditId={corrente.auditId}
            bosses={bosses}
            encounters={encounters}
            podeCalcular={corrente.status === 'pronta'}
            somenteLeitura={cancelada}
          />
        </Secao>
      )}

      <Secao titulo="Saldos e pagamento">
        {saldos.tipo === 'ok' ? (
          <Saldos saldos={saldos.dados.saldos} somenteLeitura={cancelada} />
        ) : (
          <Indisponivel />
        )}
      </Secao>

      {FASES_DO_CLOSING.has(fase) && (
        <Secao titulo="Round Closing Report">
          <PublicarClosing roundId={roundId} />
        </Secao>
      )}
    </main>
  );
}

function Cabecalho({ fase }: { fase?: string }) {
  return (
    <div>
      <p className="text-bronze font-mono text-xs tracking-widest uppercase">
        <Link href="/interno/bet-officer" className="hover:text-accent">
          Titan Bet · Officer Panel
        </Link>
        {fase ? ` · ${fase}` : ''}
      </p>
      <h1 className="text-fg mt-2 text-2xl font-semibold tracking-tight">Rodada</h1>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-fg text-lg font-semibold tracking-tight">{titulo}</h2>
      {children}
    </section>
  );
}

function Indisponivel() {
  return <p className="text-fg-muted text-sm">Não foi possível carregar agora.</p>;
}
