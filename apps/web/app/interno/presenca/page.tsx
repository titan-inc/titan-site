import {
  canSeeOthersHistory,
  isPresent,
  needsReview,
  type AttendanceEntry,
  type RaidNightInfo,
} from '@titan/shared';
import { redirect } from 'next/navigation';
import { getAttendanceReport, getSessionUser } from '../../../lib/api';
import { Estado } from './_components/estado';
import { NotaDoRl } from './_components/nota-do-rl';

export const metadata = { title: 'Presença — Titan Inc' };

/** "28/07" a partir de "2026-07-28". A string já é a data no fuso da guilda. */
function dataCurta(date: string): string {
  const [, mes, dia] = date.split('-');
  return `${dia}/${mes}`;
}

/**
 * Cabeçalho da noite — o que se lê com a noite FECHADA.
 *
 * Carrega o resumo de propósito. Um accordion cujo cabeçalho só repete data e
 * instância troca 1054 linhas de scroll por 60 cliques às cegas: você teria que
 * abrir noite por noite só para descobrir onde há trabalho.
 *
 * O trabalho desta tela é um só — achar quem ficou em "Não Raidou" e anotar o
 * motivo, porque é o único estado que o log não desambigua (Regra 7). Então é
 * a contagem de pendências que fica em destaque, não a de presentes.
 */
function Cabecalho({ night, entries }: { night: RaidNightInfo; entries: AttendanceEntry[] }) {
  const presentes = entries.filter((e) => isPresent(e.state)).length;

  // Pendência é "precisa de motivo E ainda não tem". Contar as já anotadas
  // deixaria o número parado depois do trabalho feito.
  const semMotivo = entries.filter((e) => needsReview(e.state) && !e.note).length;

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-fg font-mono tabular-nums">{dataCurta(night.date)}</span>
      <span className="text-fg-muted text-sm">{night.instance}</span>
      <span className="text-fg-subtle text-xs">{night.difficulty}</span>

      {night.optional && (
        // Run de alt conta separado da raid do core — nem no mesmo número, nem
        // descartada. Quem aparece nas opcionais está se dedicando.
        <span className="border-border text-fg-subtle rounded border px-1.5 py-0.5 text-xs">
          opcional
        </span>
      )}

      {night.bossPulls === null ? (
        <span className="text-fg-subtle text-xs">sem log com pull</span>
      ) : (
        <span className="text-fg-subtle text-xs">{night.bossPulls} pulls</span>
      )}

      {/* Noite sem log não afirma nada sobre quem estava lá, então mostrar
          "0 presentes" ali seria mentira com cara de dado. */}
      {night.bossPulls !== null && (
        <span className="text-fg-subtle text-xs">{presentes} presentes</span>
      )}

      {semMotivo > 0 && <span className="text-danger text-xs">{semMotivo} sem motivo</span>}
    </div>
  );
}

/**
 * Presença de raid. **Só oficial** — Regra 7.
 *
 * Até a TIT-150 esta rota servia duas telas: oficial via todo mundo, membro via
 * o próprio histórico. A visão de membro saiu porque não tinha usuário — os
 * players não entram no site, mesmo tendo acesso.
 *
 * O gate aqui é `canSeeOthersHistory()` e não `isActingOfficer()`: a pergunta
 * que esta tela faz é literalmente "pode ver o histórico dos outros?". Quem
 * checa a precondição é o `OfficerGuard`, no endpoint — e é ele que vale,
 * porque isto aqui é UX (Regra 5).
 */
export default async function PresencaPage() {
  const user = await getSessionUser();
  if (!user) redirect('/?erro=sessao');
  if (!canSeeOthersHistory(user)) redirect('/interno');

  const report = await getAttendanceReport();

  return (
    <main className="flex flex-1 flex-col gap-6">
      <div>
        <p className="text-bronze font-mono text-xs tracking-widest uppercase">Time de raid</p>
        <h1 className="text-fg mt-2 text-2xl font-semibold tracking-tight">Presença</h1>
        <p className="text-fg-muted mt-2 text-sm">
          O que cada pessoa confirmou no signup, cruzado com quem apareceu em pull de boss no log.
          “Não raidou” é o único caso que o log não explica — banco decidido na hora e furo são
          idênticos ali.
        </p>
      </div>

      <VisaoOficial report={report} />
    </main>
  );
}

function VisaoOficial({ report }: { report: Awaited<ReturnType<typeof getAttendanceReport>> }) {
  if (report === null || report.nights.length === 0) {
    return (
      <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
        Nenhuma noite de raid gravada ainda. A ingestão roda diariamente e o histórico do WoWAudit
        pode ser trazido de uma vez com{' '}
        <code className="text-fg-subtle">probe:attendance --all</code>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {report.nights.map((night, i) => (
        // <details> nativo, e não accordion em JS: a página é server component,
        // e o nativo já traz teclado, foco e Ctrl+F do navegador de graça.
        //
        // A noite mais recente abre por padrão — abrir a tela e ver a última
        // raid é o caso comum. As outras 59 ficam a um clique.
        <details
          key={night.id}
          open={i === 0}
          className="border-border group overflow-hidden rounded-lg border"
        >
          {/* `list-none` resolve na maioria dos navegadores; o seletor webkit é
              para o Safari, que ignora e desenha o triângulo dele por cima. */}
          <summary className="border-border bg-surface hover:bg-surface/70 cursor-pointer list-none border-b px-4 py-3 transition-colors [&::-webkit-details-marker]:hidden">
            <div className="flex items-baseline gap-2">
              {/* Marcador próprio: o triângulo nativo não é estilizável de
                  forma consistente entre navegadores. */}
              <span
                aria-hidden
                className="text-fg-subtle mt-0.5 shrink-0 text-xs transition-transform group-open:rotate-90"
              >
                ▸
              </span>
              <Cabecalho night={night} entries={night.entries} />
            </div>
          </summary>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-border text-fg-subtle border-b">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Personagem
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Signup
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Estado
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Pulls
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Motivo
                  </th>
                </tr>
              </thead>
              <tbody>
                {night.entries.map((e) => (
                  <tr key={e.id} className="border-border/60 border-b last:border-0">
                    <td className="text-fg px-4 py-2 font-mono">
                      {e.name}
                      <span className="text-fg-subtle">-{e.realm}</span>
                    </td>
                    <td className="text-fg-muted px-4 py-2">{e.signup ?? '—'}</td>
                    <td className="px-4 py-2">
                      <Estado state={e.state} />
                    </td>
                    <td className="text-fg-muted px-4 py-2 font-mono tabular-nums">
                      {e.pulls === null ? '—' : e.pulls}
                      {/* Entrar na pull 5 pode ser atraso ou rodízio normal. O
                          número aparece; a conclusão é do RL. */}
                      {e.firstPull !== null && e.firstPull > 1 && (
                        <span className="text-fg-subtle ml-2 text-xs">
                          entrou na {e.firstPull}ª
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {needsReview(e.state) ? (
                        <NotaDoRl id={e.id} inicial={e.note} />
                      ) : (
                        <span className="text-fg-subtle text-xs">{e.note ?? ''}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}
