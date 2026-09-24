import { Inject, Injectable, Optional } from '@nestjs/common';
import type { BetMarketKind, Prisma } from '@prisma/client';
import type { ResultadosDaAuditoria } from '@titan/shared';
import { loadGuildTimezone } from '../config/guild.config';
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
  consolidarComPares,
  JANELA_DE_DUPLICATA_MS,
  killDaSemana,
  pullValida,
  motivoDaEvidencia,
  resultadoFirstDeathFarm,
  resultadoFirstDeathProgressao,
  resultadoTopMetrica,
  resultadoWeekly,
  type KillDaSemana,
  type ParDeDuplicata,
  type PullDaSemana,
  type Resultado,
} from './resultados';
import { motivoDaJanelaFechada } from './fases';
import { RELOGIO, relogioDoSistema, type Relogio } from './relogio';
import { leituraDoSnapshot } from './snapshot';
import { TitanBetRepository, type ResultadoParaGravar } from './titan-bet.repository';

/**
 * Versão do algoritmo gravada com cada resultado (§15.10). `titanbet-2`: Weekly
 * por boss (D-54) e `sem_vencedor` no lugar da proposta de VOID (D-61).
 */
export const VERSAO_DO_ALGORITMO = 'titanbet-2';

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
 * Lê **só** os snapshots que o Auditar congelou (D-76, T-A12), na sessão de
 * cada report (D-26): nenhuma leitura do WCL. Os valores são os da tabela do
 * WCL no instante do Auditar (D-43, D-47) e ficam na evidência; o banco não
 * deixa mudar depois.
 *
 * Nada aqui confirma resultado nem mexe em dinheiro: VOID é proposta (D-16), e
 * `W = 0` é resultado — a redistribuição é do settlement (D-44).
 */
@Injectable()
export class CalculoService {
  private readonly timezone = loadGuildTimezone();

  // Sem porta para o WCL (D-76): o cálculo é determinístico sobre os snapshots
  // que o Auditar congelou.
  constructor(
    private readonly repo: TitanBetRepository,
    @Optional() @Inject(RELOGIO) private readonly agora: Relogio = relogioDoSistema,
  ) {}

  async calcular(auditId: string): Promise<void> {
    const a = await this.repo.auditoriaParaCalcular(auditId);
    if (!a) throw new AuditoriaRecusada(`a auditoria ${auditId} não existe`);
    if (a.status !== 'pronta') {
      throw new AuditoriaRecusada(
        `a auditoria está ${a.status} — só se calcula a pronta; recalcular é outra tentativa`,
      );
    }
    // Calcular não é caminho em volta do Auditar (D-73).
    const fechada = motivoDaJanelaFechada(a.round.cutoffAt, this.agora(), this.timezone);
    if (fechada) throw new AuditoriaRecusada(fechada);

    const encounters = new Map(a.round.encounters.map((e) => [e.encounterId, e.id]));
    const candidatos: CandidatoIdentificavel[] = a.round.candidates;

    const pulls: PullDaSemana[] = [];
    const origem = new Map<PullDaSemana, Origem>();
    const fontes: Prisma.InputJsonObject[] = [];
    for (const f of a.sources) {
      // Sessão declarada sem raid (D-60): resolvida, sem pulls.
      if (f.resolution === 'sem_raid') {
        fontes.push({ session: f.session, semRaid: true });
        continue;
      }
      if (f.reports.length === 0) {
        throw new AuditoriaRecusada(`a sessão ${f.session} está sem fonte`);
      }
      // Todos os `titanbet*` da sessão, lidos como foram congelados (D-63, §15.10).
      for (const r of f.reports) {
        // O snapshot congelado no Auditar (D-76) — nunca o WCL de agora.
        if (r.snapshot === null) {
          throw new AuditoriaRecusada(
            `a tentativa ${a.attempt} é anterior ao congelamento dos dados (D-76): o report ` +
              `${r.reportCode} não tem snapshot — audite de novo para calcular`,
          );
        }
        const report: LeituraDoReport = leituraDoSnapshot(r.snapshot);
        const doReport = pullsDoReport(report, f.session, encounters, candidatos);
        const fights = report.fights.filter((x) => encounters.has(x.encounterID));
        doReport.forEach((p, i) => origem.set(p, { report, fight: fights[i]! }));
        pulls.push(...doReport);
        fontes.push({
          session: f.session,
          code: r.reportCode,
          title: r.reportTitle,
          revision: r.reportRevision,
          startTime: r.reportStartTime.toISOString(),
        });
      }
    }
    // Uma timeline só: a mesma pull em dois reports conta uma vez (D-63).
    const { unicas: timeline, pares } = consolidarComPares(pulls);

    const agora = new Date();
    const contexto: ContextoDaEvidencia = {
      comum: {
        versao: 2,
        algoritmo: VERSAO_DO_ALGORITMO,
        computedAt: agora.toISOString(),
        // O vínculo com a rodada, a tentativa e o snapshot congelado no Ready.
        rodada: {
          roundId: a.roundId,
          auditId: a.id,
          attempt: a.attempt,
          candidatosCongeladosEm: a.round.readyAt?.toISOString() ?? null,
        },
        fontes,
      },
      origem,
      pares,
    };
    const apostas = await this.repo.apostasValidasDaRodada(a.roundId);
    const resultados = a.round.markets.map((m) => {
      const r = this.resultadoDoMercado(m, a, timeline, origem, candidatos);
      return this.paraGravar(m, r, apostas, contexto);
    });

    try {
      await this.repo.gravarCalculo({ auditId, roundId: a.roundId, agora, resultados });
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
        // VOID guarda o motivo na coluna; sem vencedor, na evidência (D-61).
        motivo: r.voidReason ?? motivoDaEvidencia(r.evidence),
        validPool: r.validPool,
        prizePool: r.prizePool,
        winningStake: r.winningStake,
        vencedores: r.winners.map((w) => w.candidate),
        bossesVencedores: r.kills.map((k) => k.roundEncounterId),
        evidencia: r.evidence as Record<string, unknown>,
      })),
    };
  }

  private resultadoDoMercado(
    m: Mercado,
    a: Auditoria,
    pulls: PullDaSemana[],
    origem: Map<PullDaSemana, Origem>,
    candidatos: CandidatoIdentificavel[],
  ): ResultadoComPulls {
    const elegiveis = new Set(
      candidatosDoMercado(m.kind, a.round.candidates).map((c) => c.characterId),
    );

    if (m.kind === 'weekly_progression') {
      // D-54: as opções são os bosses de progressão congelados no Ready; os
      // mortos na semana vencem. Eles vão para os "kills" do resultado, não para
      // os vencedores — esses são personagens.
      const progressao = a.round.encounters
        .filter((e) => e.track === 'progressao')
        .map((e) => e.id);
      const resultado = resultadoWeekly(pulls, progressao);
      return {
        resultado:
          resultado.outcome === 'vencedores' ? { ...resultado, vencedores: [] } : resultado,
        kills: resultado.outcome === 'vencedores' ? resultado.vencedores : [],
        encounters: progressao,
        // As kills dos bosses de progressão: é delas que sai a Weekly.
        usadas: progressao.flatMap((id) => {
          const k = killDaSemana(pulls, id);
          return k.tipo === 'kill' ? [k.pull] : [];
        }),
        elegiveisDaMorte: null,
      };
    }

    if (m.kind === 'first_death' && m.track === 'progressao') {
      return {
        resultado: resultadoFirstDeathProgressao(pulls, m.roundEncounterId!, elegiveis),
        kills: [],
        encounters: [m.roundEncounterId!],
        // Todas as tries válidas da semana (D-29), na ordem em que aconteceram.
        usadas: pulls
          .filter((p) => p.encounterId === m.roundEncounterId && pullValida(p))
          .sort((x, y) => x.startTime - y.startTime),
        elegiveisDaMorte: elegiveis,
      };
    }

    const kill = killDaSemana(pulls, m.roundEncounterId!);
    const usadas = kill.tipo === 'kill' ? [kill.pull] : [];
    const encounters = [m.roundEncounterId!];
    if (m.kind === 'first_death') {
      return {
        resultado: resultadoFirstDeathFarm(kill, elegiveis),
        kills: [],
        encounters,
        usadas,
        elegiveisDaMorte: elegiveis,
      };
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
      encounters,
      usadas,
      elegiveisDaMorte: null,
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
    r: ResultadoComPulls,
    apostas: Awaited<ReturnType<TitanBetRepository['apostasValidasDaRodada']>>,
    contexto: ContextoDaEvidencia,
  ): ResultadoParaGravar {
    // Nenhum caminho automático produz `anulado` (D-61): o resultado é vencedores
    // ou sem vencedor.
    const doMercado = apostas.filter((b) => b.marketId === m.id);
    const V = doMercado.reduce((s, b) => s + b.stake, 0);
    const evidencia: Prisma.InputJsonObject = {
      ...contexto.comum,
      mercado: { kind: m.kind, track: m.track, roundEncounterId: m.roundEncounterId },
      resultado: r.resultado.evidencia as Prisma.InputJsonValue,
      // Qual report, qual fight, quando e quanto durou; no First Death, quem
      // morreu até a primeira elegível (§15.10) — nunca o payload do WCL.
      pulls: r.usadas.map((p) => pullNaEvidencia(p, contexto.origem, r.elegiveisDaMorte)),
      deduplicacao: {
        janelaMs: JANELA_DE_DUPLICATA_MS,
        regra:
          'mesmo encounter, reports diferentes, início a menos da janela; ' +
          'fica a cópia que começou primeiro',
        pares: contexto.pares
          .filter((x) => r.encounters.includes(x.mantida.encounterId))
          .map((x) => ({
            mantida: idDaPull(x.mantida, contexto.origem),
            descartada: idDaPull(x.descartada, contexto.origem),
            diferencaMs: Math.abs(x.descartada.startTime - x.mantida.startTime),
          })),
      },
      ...r.extra,
    };

    if (r.resultado.outcome === 'sem_vencedor') {
      // D-61: não é VOID. V e P ficam — o P é redistribuído no settlement —, W é
      // zero, e o motivo vai para a evidência.
      return {
        marketId: m.id,
        outcome: 'sem_vencedor',
        voidReason: null,
        validPool: V,
        prizePool: Math.floor((9 * V) / 10),
        winningStake: 0,
        evidencia: { ...evidencia, motivo: r.resultado.motivo },
        algorithmVersion: VERSAO_DO_ALGORITMO,
        vencedores: [],
        kills: [],
      };
    }

    const vencedores = r.resultado.vencedores;
    const vence = (b: (typeof doMercado)[number]) =>
      eWeekly(m.kind)
        ? b.targetEncounterId !== null && r.kills.includes(b.targetEncounterId)
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

interface ResultadoComPulls {
  resultado: Resultado<unknown>;
  kills: string[];
  /** Os `BetRoundEncounter` do mercado — de quais bosses são os pares deduplicados. */
  encounters: string[];
  /** As pulls de que o resultado saiu, para a evidência. */
  usadas: PullDaSemana[];
  /** First Death: quem é elegível, para cortar a sequência de mortes; senão `null`. */
  elegiveisDaMorte: ReadonlySet<string> | null;
  extra?: Prisma.InputJsonObject;
}

interface ContextoDaEvidencia {
  /** O que toda evidência da tentativa carrega: versão, algoritmo, hora, vínculo, fontes. */
  comum: Prisma.InputJsonObject;
  origem: Map<PullDaSemana, Origem>;
  pares: ParDeDuplicata[];
}

function idDaPull(p: PullDaSemana, origem: Map<PullDaSemana, Origem>) {
  return { report: p.report, fightId: origem.get(p)!.fight.id, startTime: p.startTime };
}

/**
 * A pull como a §15.10 pede: report, fight, encounter do WCL, dificuldade, kill,
 * início, fim e duração (o denominador de DPS/HPS). No First Death, as mortes
 * em ordem até a primeira elegível — os de fora do snapshot aparecem, pulados
 * pelo resultado (D-13), e empates na mesma ms entram todos (D-14).
 */
function pullNaEvidencia(
  p: PullDaSemana,
  origem: Map<PullDaSemana, Origem>,
  elegiveis: ReadonlySet<string> | null,
): Prisma.InputJsonObject {
  const { report, fight } = origem.get(p)!;
  const base = {
    session: p.session,
    report: p.report,
    fightId: fight.id,
    encounterId: fight.encounterID,
    difficulty: p.difficulty,
    kill: p.kill,
    startTime: p.startTime,
    endTime: report.startTime + fight.endTime,
    duracaoMs: fight.endTime - fight.startTime,
  };
  if (!elegiveis) return base;

  const ordem = [...p.deaths].sort((x, y) => x.timestamp - y.timestamp);
  const primeira = ordem.find((d) => elegiveis.has(d.characterId))?.timestamp;
  const ator = new Map(report.actors.map((x) => [x.id, x]));
  return {
    ...base,
    mortes: ordem
      .filter((d) => primeira === undefined || d.timestamp <= primeira)
      .map((d) => {
        const quem = d.ator === undefined ? undefined : ator.get(d.ator);
        return {
          quem: d.characterId,
          name: quem?.name ?? null,
          server: quem?.server ?? null,
          timestamp: d.timestamp,
        };
      }),
  };
}

function eWeekly(kind: BetMarketKind): boolean {
  return kind === 'weekly_progression';
}
