import { Inject, Injectable } from '@nestjs/common';
import type { AuditoriaCorrente } from '@titan/shared';
import { loadGuildTimezone } from '../config/guild.config';
import { WarcraftLogsService } from '../warcraftlogs/warcraftlogs.service';
import { classificarReports, resolverSessao, type ReportDaGuilda, type Sessao } from './auditoria';
import { podeAuditar } from './fases';
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
    const fontes: FonteParaGravar[] = (['terca', 'quinta'] as const).map((session) => {
      const candidatos = porSessao[session].map(gravavel);
      const { resolution, report } = resolverSessao(candidatos);
      return { session, resolution, report, candidatos };
    });
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
        report:
          f.reportCode === null
            ? null
            : {
                code: f.reportCode,
                title: f.reportTitle!,
                revision: f.reportRevision!,
                startTime: f.reportStartTime!.toISOString(),
              },
        candidatos: (f.candidates as unknown as ReportGravado[]).map((c) => ({
          ...c,
          startTime: new Date(c.startTime).toISOString(),
        })),
        resolvedByBattletag: f.resolvedByBattletag,
        resolvedAt: f.resolvedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * A escolha do officer numa sessão ambígua (D-25): só entre os candidatos que
   * o Auditar gravou, com a referência como foi lida (T-A12).
   */
  async escolherFonte(
    auditId: string,
    session: Sessao,
    reportCode: string,
    officer: Officer,
  ): Promise<void> {
    const r = await this.repo.escolherFonte({
      auditId,
      session,
      officer,
      agora: new Date(),
      escolher: ({ resolution, candidatos }) => {
        if (resolution !== 'ambigua') {
          return { recusa: `a fonte de ${session} está ${resolution} — só se escolhe na ambígua` };
        }
        const report = candidatos.find((c) => c.code === reportCode);
        if (!report) return { recusa: `${reportCode} não é candidato de ${session}` };
        return { report };
      },
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
