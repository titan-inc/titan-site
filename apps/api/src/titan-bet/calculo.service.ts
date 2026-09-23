import { Inject, Injectable } from '@nestjs/common';
import type { BetMarketKind, Prisma } from '@prisma/client';
import type { ResultadosDaAuditoria } from '@titan/shared';
import { WarcraftLogsService, type RaidCatalog } from '../warcraftlogs/warcraftlogs.service';
import { AuditoriaRecusada } from './auditoria.service';
import { candidatosDoMercado } from './candidatos';
import {
  pullsDoReport,
  valoresDaKill,
  type CandidatoIdentificavel,
  type FightDoReport,
  type LeituraDoReport,
} from './leitura-wcl';
import {
  killDaSemana,
  killsDaSemana,
  resultadoFirstDeathFarm,
  resultadoFirstDeathProgressao,
  resultadoTopMetrica,
  weeklyVence,
  type KillDaSemana,
  type PullDaSemana,
  type Resultado,
} from './resultados';
import { TitanBetRepository, type ResultadoParaGravar } from './titan-bet.repository';

/** O pedaço do WCL que o cálculo usa: o catálogo e o report oficial. */
export interface ReportsParaCalculo {
  getRaidCatalog(): Promise<RaidCatalog>;
  getTitanBetReport(code: string, encounterIds: number[]): Promise<LeituraDoReport>;
}

/** Versão do algoritmo gravada com cada resultado (§15.10). */
export const VERSAO_DO_ALGORITMO = 'titanbet-1';

const MYTHIC = 5;

type Auditoria = NonNullable<Awaited<ReturnType<TitanBetRepository['auditoriaParaCalcular']>>>;
type Mercado = Auditoria['round']['markets'][number];

/** A pull e de onde ela veio — para ler as tabelas da kill. */
interface Origem {
  report: LeituraDoReport;
  fight: FightDoReport;
}

/**
 * O cálculo do Auditar (§7.3): da auditoria `pronta`, com as fontes congeladas,
 * aos resultados de todos os mercados e a auditoria `calculada`.
 *
 * Lê do WCL **só** os reports que o Auditar congelou (T-A12), na sessão de
 * cada um (D-26). Os valores são os da tabela do WCL no momento do cálculo
 * (D-43, D-47) e ficam na evidência; o banco não deixa mudar depois.
 *
 * Nada aqui confirma resultado nem mexe em dinheiro: VOID é proposta (D-16), e
 * `W = 0` é resultado — a redistribuição é do settlement (D-44).
 */
@Injectable()
export class CalculoService {
  constructor(
    private readonly repo: TitanBetRepository,
    @Inject(WarcraftLogsService) private readonly wcl: ReportsParaCalculo,
  ) {}

  async calcular(auditId: string): Promise<void> {
    const a = await this.repo.auditoriaParaCalcular(auditId);
    if (!a) throw new AuditoriaRecusada(`a auditoria ${auditId} não existe`);
    if (a.status !== 'pronta') {
      throw new AuditoriaRecusada(
        `a auditoria está ${a.status} — só se calcula a pronta; recalcular é outra tentativa`,
      );
    }

    const encounters = new Map(a.round.encounters.map((e) => [e.encounterId, e.id]));
    const candidatos: CandidatoIdentificavel[] = a.round.candidates;
    const catalogo = await this.wcl.getRaidCatalog();

    const pulls: PullDaSemana[] = [];
    const origem = new Map<PullDaSemana, Origem>();
    const fontes: Prisma.InputJsonObject[] = [];
    for (const f of a.sources) {
      if (!f.reportCode) throw new AuditoriaRecusada(`a sessão ${f.session} está sem fonte`);
      let report: LeituraDoReport;
      try {
        report = await this.wcl.getTitanBetReport(f.reportCode, [...encounters.keys()]);
      } catch (erro: unknown) {
        const motivo = erro instanceof Error ? erro.message : String(erro);
        throw new AuditoriaRecusada(`o Warcraft Logs não respondeu: ${motivo}`);
      }
      const doReport = pullsDoReport(report, f.session, encounters, candidatos);
      const fights = report.fights.filter((x) => encounters.has(x.encounterID));
      doReport.forEach((p, i) => origem.set(p, { report, fight: fights[i]! }));
      pulls.push(...doReport);
      fontes.push({
        session: f.session,
        code: f.reportCode,
        title: f.reportTitle,
        revision: f.reportRevision,
        startTime: f.reportStartTime?.toISOString() ?? null,
      });
      this.conferirWeekly(a, report, catalogo);
    }

    const apostas = await this.repo.apostasValidasDaRodada(a.roundId);
    const resultados = a.round.markets.map((m) => {
      const r = this.resultadoDoMercado(m, a, pulls, origem, candidatos);
      return this.paraGravar(m, r, apostas, fontes);
    });

    try {
      await this.repo.gravarCalculo({ auditId, roundId: a.roundId, agora: new Date(), resultados });
    } catch (erro: unknown) {
      // Dois cálculos ao mesmo tempo: o banco deixa passar um (unique e trigger).
      const motivo = erro instanceof Error ? erro.message : String(erro);
      throw new AuditoriaRecusada(`os resultados não foram gravados: ${motivo}`);
    }
  }

  /** Os resultados de uma tentativa, para o officer revisar; `null` se ela não existe. */
  async resultados(auditId: string): Promise<ResultadosDaAuditoria | null> {
    const a = await this.repo.resultadosDaAuditoria(auditId);
    if (!a) return null;
    return {
      auditId: a.id,
      status: a.status,
      calculatedAt: a.calculatedAt?.toISOString() ?? null,
      mercados: a.results.map((r) => ({
        marketId: r.marketId,
        kind: r.market.kind,
        outcome: r.outcome,
        voidReason: r.voidReason,
        validPool: r.validPool,
        prizePool: r.prizePool,
        winningStake: r.winningStake,
        vencedores: r.winners.map((w) => w.candidate),
        kills: r.kills.map((k) => k.roundEncounterId),
        evidencia: r.evidence as Record<string, unknown>,
      })),
    };
  }

  /**
   * `K` com um boss morto fora do conjunto da Weekly depende da OQ-47 (`K` ∩
   * encounters da Weekly?). Sem a resposta, o cálculo não escolhe uma leitura.
   */
  private conferirWeekly(a: Auditoria, report: LeituraDoReport, catalogo: RaidCatalog): void {
    if (!a.round.markets.some((m) => m.kind === 'weekly_progression')) return;
    const daWeekly = new Set(
      a.round.encounters.filter((e) => e.inWeeklyProgression).map((e) => e.encounterId),
    );
    const fora = report.fights.filter(
      (f) =>
        f.kill === true &&
        f.difficulty === MYTHIC &&
        catalogo.encounters.has(f.encounterID) &&
        !daWeekly.has(f.encounterID),
    );
    if (fora.length > 0) {
      throw new AuditoriaRecusada(
        `kill Mythic de boss fora da Weekly Progression (encounter ${fora[0]!.encounterID}): ` +
          'o K depende da OQ-47 — a auditoria não escolhe uma leitura',
      );
    }
  }

  private resultadoDoMercado(
    m: Mercado,
    a: Auditoria,
    pulls: PullDaSemana[],
    origem: Map<PullDaSemana, Origem>,
    candidatos: CandidatoIdentificavel[],
  ): { resultado: Resultado<unknown>; kills: string[]; extra?: Prisma.InputJsonObject } {
    const elegiveis = new Set(
      candidatosDoMercado(m.kind, a.round.candidates).map((c) => c.characterId),
    );

    if (m.kind === 'weekly_progression') {
      const k = killsDaSemana(pulls, { terca: true, quinta: true });
      if (k.tipo === 'indeterminado') throw new AuditoriaRecusada('K indeterminado');
      return {
        resultado: { outcome: 'vencedores', vencedores: [], evidencia: { K: k.encounterIds } },
        kills: k.encounterIds,
      };
    }

    if (m.kind === 'first_death' && m.track === 'progressao') {
      return {
        resultado: resultadoFirstDeathProgressao(pulls, m.roundEncounterId!, elegiveis),
        kills: [],
      };
    }

    const kill = killDaSemana(pulls, m.roundEncounterId!);
    if (kill.tipo === 'revisao') {
      throw new AuditoriaRecusada(`pede revisão do officer: ${kill.motivo} (§7.2, OQ-40)`);
    }
    if (m.kind === 'first_death') {
      return { resultado: resultadoFirstDeathFarm(kill, elegiveis), kills: [] };
    }

    const valores =
      kill.tipo === 'kill'
        ? valoresDaKill(
            m.kind,
            this.leituraDaKill(kill, origem),
            origem.get(kill.pull)!.report,
            candidatos,
          )
        : [];
    const resultado = resultadoTopMetrica(kill, valores, elegiveis);
    const lidos = new Map(valores.map((v) => [v.characterId, v.evidencia]));
    return {
      resultado,
      kills: [],
      // O que foi lido de cada candidato, como veio (§15.10): é a prova do valor.
      extra: {
        valores: valores
          .filter((v) => elegiveis.has(v.characterId))
          .map((v) => ({
            characterId: v.characterId,
            valor: v.valor,
            evidencia: lidos.get(v.characterId)!,
          })),
      },
    };
  }

  private leituraDaKill(
    kill: Extract<KillDaSemana, { tipo: 'kill' }>,
    origem: Map<PullDaSemana, Origem>,
  ) {
    const { report, fight } = origem.get(kill.pull)!;
    const leitura = report.kills[fight.id];
    if (!leitura) {
      throw new AuditoriaRecusada(
        `o report ${report.code} veio sem as tabelas da kill ${fight.id}`,
      );
    }
    return { fight, leitura };
  }

  private paraGravar(
    m: Mercado,
    r: { resultado: Resultado<unknown>; kills: string[]; extra?: Prisma.InputJsonObject },
    apostas: Awaited<ReturnType<TitanBetRepository['apostasValidasDaRodada']>>,
    fontes: Prisma.InputJsonObject[],
  ): ResultadoParaGravar {
    const doMercado = apostas.filter((b) => b.marketId === m.id);
    const V = doMercado.reduce((s, b) => s + b.stake, 0);
    const evidencia: Prisma.InputJsonObject = {
      versao: 1,
      algoritmo: VERSAO_DO_ALGORITMO,
      fontes,
      mercado: { kind: m.kind, track: m.track, roundEncounterId: m.roundEncounterId },
      resultado: r.resultado.evidencia as Prisma.InputJsonValue,
      ...r.extra,
    };

    if (r.resultado.outcome === 'anulado') {
      return {
        marketId: m.id,
        outcome: 'anulado',
        voidReason: r.resultado.voidReason,
        validPool: V,
        prizePool: null,
        winningStake: null,
        evidencia,
        algorithmVersion: VERSAO_DO_ALGORITMO,
        vencedores: [],
        kills: [],
      };
    }

    const vencedores = r.resultado.vencedores;
    const vence = (b: (typeof doMercado)[number]) =>
      eWeekly(m.kind)
        ? weeklyVence(
            b.weeklySelections.map((s) => s.roundEncounterId),
            r.kills,
          )
        : b.targetCharacterId !== null && vencedores.includes(b.targetCharacterId);
    return {
      marketId: m.id,
      outcome: 'vencedores',
      voidReason: null,
      validPool: V,
      prizePool: Math.floor((9 * V) / 10),
      winningStake: doMercado.filter(vence).reduce((s, b) => s + b.stake, 0),
      evidencia,
      algorithmVersion: VERSAO_DO_ALGORITMO,
      vencedores,
      kills: r.kills,
    };
  }
}

function eWeekly(kind: BetMarketKind): boolean {
  return kind === 'weekly_progression';
}
