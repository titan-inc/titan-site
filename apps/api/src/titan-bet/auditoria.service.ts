import { Inject, Injectable } from '@nestjs/common';
import type { AuditoriaCorrente } from '@titan/shared';
import { loadGuildTimezone } from '../config/guild.config';
import { WarcraftLogsService } from '../warcraftlogs/warcraftlogs.service';
import { classificarReports, resolverSessao, type ReportDaGuilda, type Sessao } from './auditoria';
import { podeAuditar } from './fases';
import { TitanBetRepository, type FonteParaGravar } from './titan-bet.repository';

/** O Auditar foi recusado; nada foi gravado. */
export class AuditoriaRecusada extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'AuditoriaRecusada';
  }
}

/** O pedaço do WCL que o Auditar usa. */
export type ReportsDaGuilda = Pick<WarcraftLogsService, 'listGuildReports'>;

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
  ) {}

  async auditar(roundId: string, officer: Officer): Promise<{ auditId: string }> {
    const rodada = await this.repo.rodadaParaAuditar(roundId);
    if (!rodada) throw new AuditoriaRecusada(`a rodada ${roundId} não existe`);

    const estado = { ...rodada, temClosingReport: false };
    if (!podeAuditar(estado, new Date())) {
      throw new AuditoriaRecusada(motivoParaNaoAuditar(estado, new Date()));
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
    // declaração do officer resolve (D-60).
    const fontes: FonteParaGravar[] = (['terca', 'quinta'] as const).map((session) => ({
      session,
      ...resolverSessao(porSessao[session].map(gravavel)),
    }));
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
): string {
  if (estado.readyAt === null) return 'a rodada não teve Ready — não houve aposta';
  if (agora < estado.cutoffAt) return 'as apostas ainda estão abertas — o cutoff não passou';
  return 'a rodada já tem auditoria confirmada';
}
