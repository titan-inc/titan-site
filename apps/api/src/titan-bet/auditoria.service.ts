import { Inject, Injectable, Optional } from '@nestjs/common';
import type { AuditoriaCorrente } from '@titan/shared';
import { loadGuildTimezone } from '../config/guild.config';
import { WarcraftLogsService } from '../warcraftlogs/warcraftlogs.service';
import { classificarReports, resolverSessao, type ReportDaGuilda, type Sessao } from './auditoria';
import { motivoDaJanelaFechada, podeAuditar } from './fases';
import { RELOGIO, relogioDoSistema, type Relogio } from './relogio';
import { congelarReport } from './snapshot';
import {
  TitanBetRepository,
  type FonteParaGravar,
  type ReportGravado,
} from './titan-bet.repository';

/** O Auditar foi recusado; nada foi gravado. */
export class AuditoriaRecusada extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'AuditoriaRecusada';
  }
}

/**
 * O pedaço do WCL que o Auditar usa: a descoberta dos reports e a leitura de
 * cada um, que o Auditar congela (D-76). É o único lugar do Titan Bet que lê o
 * WCL para resultado.
 */
export type ReportsDaGuilda = Pick<WarcraftLogsService, 'listGuildReports' | 'getTitanBetReport'>;

interface Officer {
  userId: string;
  battletag: string;
}

/**
 * Até onde a janela pedida ao WCL vai depois do cutoff: a quinta inteira, com
 * folga para o fuso. O que sai do calendário é descartado pela sessão.
 */
const JANELA_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * Auditar (D-30; spec §7.2): acha o report oficial `titanbet*` de cada sessão
 * da rodada e registra de onde o resultado vai sair.
 *
 * Inequívoco usa sozinho. Ausente ou ambíguo para e pede o officer — o sistema
 * nunca escolhe report, e ausência nunca vira "sem raid" (D-24, D-25). O
 * cálculo dos resultados é o passo seguinte, sobre as referências gravadas
 * aqui.
 */
@Injectable()
export class AuditoriaService {
  private readonly timezone = loadGuildTimezone();

  constructor(
    private readonly repo: TitanBetRepository,
    // Tipado pelo pedaço que usa: o teste passa um WCL falso só com ele.
    @Inject(WarcraftLogsService) private readonly wcl: ReportsDaGuilda,
    @Optional() @Inject(RELOGIO) private readonly agora: Relogio = relogioDoSistema,
  ) {}

  async auditar(roundId: string, officer: Officer): Promise<{ auditId: string }> {
    const rodada = await this.repo.rodadaParaAuditar(roundId);
    if (!rodada) throw new AuditoriaRecusada(`a rodada ${roundId} não existe`);

    const estado = { ...rodada, temClosingReport: false };
    const agora = this.agora();
    if (!podeAuditar(estado, agora, this.timezone)) {
      throw new AuditoriaRecusada(motivoParaNaoAuditar(estado, agora, this.timezone));
    }

    const janela = { cutoffAt: rodada.cutoffAt, timezone: this.timezone };
    let reports: ReportDaGuilda[];
    try {
      reports = await this.wcl.listGuildReports(
        rodada.cutoffAt,
        new Date(rodada.cutoffAt.getTime() + JANELA_MS),
      );
    } catch (erro: unknown) {
      // Lacuna não é resultado (§7.4): sem a lista, não há auditoria nenhuma.
      const motivo = erro instanceof Error ? erro.message : String(erro);
      throw new AuditoriaRecusada(`o Warcraft Logs não respondeu: ${motivo}`);
    }

    const porSessao = classificarReports(reports, janela);
    // Todos os `titanbet*` da sessão são fonte (D-63); nenhum → ausente, e só a
    // declaração do officer resolve (D-60). Cada um é lido e congelado agora
    // (D-76) — antes de qualquer gravação: falhou um, não se grava nada.
    const fontes: FonteParaGravar[] = [];
    for (const session of ['terca', 'quinta'] as const) {
      const resolvida = resolverSessao(porSessao[session].map(gravavel));
      const congelados: ReportGravado[] = [];
      for (const r of resolvida.reports) {
        congelados.push(await this.congelar(r, rodada.encounterIds));
      }
      fontes.push({
        session,
        resolution: resolvida.resolution,
        reports: congelados,
      });
    }
    const status = fontes.every((f) => f.resolution === 'automatica')
      ? 'pronta'
      : 'aguardando_revisao';

    try {
      return await this.repo.gravarAuditoria({ roundId, officer, status, fontes });
    } catch (erro: unknown) {
      // Dois Auditar ao mesmo tempo disputam o mesmo `attempt`; o banco deixa
      // passar um só (unique `(roundId, attempt)`), e o outro é recusado.
      const motivo = erro instanceof Error ? erro.message : String(erro);
      throw new AuditoriaRecusada(`a auditoria não foi gravada: ${motivo}`);
    }
  }

  /**
   * Lê o report e congela o que o Calcular vai usar (D-76). A revisão lida tem
   * de ser a descoberta: se o report mudou no meio do Auditar, o snapshot não
   * corresponderia à referência — recusa, e o officer audita de novo.
   */
  private async congelar(r: ReportDaGuilda, encounterIds: number[]): Promise<ReportGravado> {
    let leitura;
    try {
      leitura = await this.wcl.getTitanBetReport(r.code, encounterIds);
    } catch (erro: unknown) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      throw new AuditoriaRecusada(
        `não foi possível congelar o report ${r.code} — o Warcraft Logs não respondeu: ${motivo}`,
      );
    }
    if (leitura.revision !== r.revision) {
      throw new AuditoriaRecusada(
        `o report ${r.code} mudou de revisão durante o Auditar (${r.revision} → ${leitura.revision}); audite de novo`,
      );
    }
    return { ...r, snapshot: congelarReport(leitura, r.title, encounterIds) };
  }

  /** A tentativa corrente, para o Officer Panel; `null` antes do primeiro Auditar. */
  async corrente(roundId: string): Promise<AuditoriaCorrente | null> {
    const a = await this.repo.auditoriaCorrente(roundId);
    if (!a || a.status === 'substituida') return null;
    return {
      auditId: a.id,
      attempt: a.attempt,
      status: a.status,
      startedByBattletag: a.startedByBattletag,
      startedAt: a.startedAt.toISOString(),
      fontes: a.sources.map((f) => ({
        session: f.session,
        resolution: f.resolution,
        reports: f.reports.map((r) => ({
          code: r.reportCode,
          title: r.reportTitle,
          revision: r.reportRevision,
          startTime: r.reportStartTime.toISOString(),
        })),
        motivoSemRaid: f.noRaidReason,
        resolvedByBattletag: f.resolvedByBattletag,
        resolvedAt: f.resolvedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * "Não houve raid oficial nesta sessão" (D-60): o officer resolve a sessão
   * ausente, com motivo. Ela fica sem pulls; a outra sessão segue normal.
   */
  async declararSemRaid(
    auditId: string,
    session: Sessao,
    motivo: string,
    officer: Officer,
  ): Promise<void> {
    const texto = motivo.trim();
    if (!texto) throw new AuditoriaRecusada('declarar sem raid exige motivo (D-60)');
    // "Sem raid" antes da hora fecharia a quinta antes de ela acontecer (D-73).
    const cutoffAt = await this.repo.cutoffDaAuditoria(auditId);
    if (!cutoffAt) throw new AuditoriaRecusada('a auditoria não existe');
    const fechada = motivoDaJanelaFechada(cutoffAt, this.agora(), this.timezone);
    if (fechada) throw new AuditoriaRecusada(fechada);
    const r = await this.repo.declararSemRaid({
      auditId,
      session,
      motivo: texto,
      officer,
      agora: new Date(),
    });
    if (r.tipo === 'recusado') throw new AuditoriaRecusada(r.motivo);
  }
}

/** Só o que o WCL respondeu e a auditoria congela — nada a mais. */
function gravavel(r: ReportDaGuilda): ReportDaGuilda {
  return { code: r.code, title: r.title, revision: r.revision, startTime: r.startTime };
}

function motivoParaNaoAuditar(
  estado: { readyAt: Date | null; cutoffAt: Date; auditoria: string | null },
  agora: Date,
  timezone: string,
): string {
  if (estado.readyAt === null) return 'a rodada não teve Ready — não houve aposta';
  if (agora < estado.cutoffAt) return 'as apostas ainda estão abertas — o cutoff não passou';
  return (
    motivoDaJanelaFechada(estado.cutoffAt, agora, timezone) ??
    'a rodada já tem auditoria confirmada'
  );
}
