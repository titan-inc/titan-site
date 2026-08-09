import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  BossProgress,
  RaidDifficulty,
  RaidProgress,
  RaidProgressReport,
  SeasonOption,
} from '@titan/shared';
import { SnapshotsRepository } from '../snapshots/snapshots.repository';
import {
  WarcraftLogsService,
  type RaidCatalog,
  type RaidPull,
} from '../warcraftlogs/warcraftlogs.service';

/** Quantas seasons aparecem no seletor. Mesmo número do relatório de M+. */
const SEASONS_NO_SELETOR = 6;

/**
 * TTL do relatório montado.
 *
 * Curto porque durante a noite de raid o log cresce e o RL quer ver a
 * progressão andar. Não é economia de cota: a season inteira custa ~130 dos
 * 3600 pontos/hora e sai em ~1s.
 */
const TTL_MS = 15 * 60 * 1000;

/** Acumulador por boss × dificuldade, antes de virar contrato. */
interface Agregado {
  pulls: number;
  kills: number;
  firstKillAt: number | null;
  bestPercent: number | null;
}

/**
 * Progressão de raid do tier, a partir dos logs.
 *
 * ## Por que a raid não é a zona do WCL
 *
 * O WCL junta as raids de um tier numa zona só. Nesta season a zona 46 chama-se
 * literalmente "VS / DR / MQD" e tem 9 bosses espalhados por **três raids**:
 * The Voidspire (6), The Dreamrift (1) e Isle of Quel'Danas (2). Agrupar por
 * zona mostraria um bloco de 9 bosses que não corresponde a nada que o time
 * reconheça.
 *
 * Quem separa é o `gameZone` de cada pull — a instância do jogo. Isso vale para
 * qualquer formato de tier: uma raid vira um grupo, três viram três, sem
 * nenhuma tabela de mapeamento para manter à mão.
 *
 * ## O que conta como pull
 *
 * Tudo que é boss de raid, sem corte de duração. A TIT-34 pedia definir o corte
 * para não inflar a contagem com pull de teste — medido em 04/08/2026 nas 1357
 * pulls da season, **a pull mais curta tem 15s e nenhuma kill tem menos de
 * 120s**. Não existe o aglomerado de pulls de 5s que justificaria o corte, e
 * inventar um limiar apagaria wipe de verdade: as 42 pulls abaixo de 30s são
 * todas wipe de Midnight Falls com 96–98% de vida, ou seja, prog real.
 */
@Injectable()
export class RaidProgressService {
  private readonly logger = new Logger(RaidProgressService.name);

  /** Um relatório pronto por season. */
  private readonly cache = new Map<number, { report: RaidProgressReport; fetchedAt: number }>();

  constructor(
    private readonly repo: SnapshotsRepository,
    private readonly wcl: WarcraftLogsService,
  ) {}

  /**
   * @param seasonId season pedida; sem ela, a mais recente gravada.
   * @returns null quando não há nenhuma season gravada ainda.
   */
  async getReport(seasonId?: number): Promise<RaidProgressReport | null> {
    const seasons = await this.repo.listSeasons(SEASONS_NO_SELETOR);
    if (seasons.length === 0) return null;

    const escolhida = seasonId ? await this.repo.findSeason(seasonId) : (seasons[0] ?? null);
    if (!escolhida) throw new NotFoundException(`Season ${seasonId} não foi gravada`);

    const cacheado = this.cache.get(escolhida.id);
    if (cacheado && Date.now() - cacheado.fetchedAt < TTL_MS) return cacheado.report;

    const opcao = (s: { id: number; patch: string | null; name: string }): SeasonOption => ({
      id: s.id,
      patch: s.patch,
      name: s.name,
    });

    try {
      // A janela da season termina onde a próxima começa. Sem próxima, é agora
      // — o tier corrente ainda está acontecendo.
      const proxima = seasons
        .filter((s) => s.startedAt > escolhida.startedAt)
        .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())[0];

      const catalogo = await this.wcl.getRaidCatalog();
      const pulls = await this.wcl.getRaidPulls(escolhida.startedAt, proxima?.startedAt ?? null);

      const report: RaidProgressReport = {
        season: opcao(escolhida),
        availableSeasons: seasons.map(opcao),
        difficulties: this.difficuldades(pulls, catalogo),
        raids: this.montarRaids(pulls, catalogo),
        fetchedAt: new Date().toISOString(),
        stale: false,
      };

      this.cache.set(escolhida.id, { report, fetchedAt: Date.now() });
      this.logger.log(
        `Progressão da season ${escolhida.id}: ${pulls.length} pulls em ${report.raids.length} raids`,
      );
      return report;
    } catch (err: unknown) {
      const motivo = err instanceof Error ? err.message : String(err);

      // Degradar para o último dado bom é o que a Regra 6 pede — mas rotulado
      // como velho, porque progressão desatualizada com cara de atual é pior
      // que a tela dizer que não conseguiu atualizar.
      if (cacheado) {
        this.logger.warn(`Warcraft Logs falhou (${motivo}); usando cache anterior`);
        return { ...cacheado.report, stale: true };
      }

      throw new Error(`Não foi possível ler o Warcraft Logs: ${motivo}`);
    }
  }

  /** Dificuldades com pull, da mais alta para a mais baixa. */
  private difficuldades(pulls: RaidPull[], catalogo: RaidCatalog): RaidDifficulty[] {
    const ids = [...new Set(pulls.map((p) => p.difficulty))].sort((a, b) => b - a);
    return ids.map((id) => ({ id, name: catalogo.difficultyNames.get(id) ?? `Dificuldade ${id}` }));
  }

  /**
   * Agrupa as pulls em raids do jogo.
   *
   * Bosses do tier que nunca foram pullados entram num grupo à parte, com
   * `id: null`. Sem pull não existe `gameZone`, então não dá para saber em qual
   * das raids do tier o boss está — e chutar seria inventar. Eles continuam
   * aparecendo porque o denominador do "6/6" é o tier inteiro: esconder quem
   * ninguém tocou faria a fração dizer que o tier acabou.
   */
  private montarRaids(pulls: RaidPull[], catalogo: RaidCatalog): RaidProgress[] {
    /** gameZone → boss → dificuldade → números. */
    const porRaid = new Map<
      number | null,
      { name: string; tier: string; zoneId: number; bosses: Map<number, Map<number, Agregado>> }
    >();

    /** Tiers que tiveram alguma pull, para achar os bosses não visitados. */
    const tiersAtivos = new Set<number>();
    const bossesVistos = new Set<number>();

    for (const pull of pulls) {
      const boss = catalogo.encounters.get(pull.encounterId);
      if (!boss) continue;

      tiersAtivos.add(boss.zoneId);
      bossesVistos.add(boss.id);

      const chave = pull.gameZoneId;
      let raid = porRaid.get(chave);
      if (!raid) {
        raid = {
          // Sem `gameZone` na pull, o nome do tier é o melhor rótulo honesto.
          name: pull.gameZoneName ?? boss.zoneName,
          tier: boss.zoneName,
          zoneId: boss.zoneId,
          bosses: new Map(),
        };
        porRaid.set(chave, raid);
      }

      let porDificuldade = raid.bosses.get(boss.id);
      if (!porDificuldade) {
        porDificuldade = new Map();
        raid.bosses.set(boss.id, porDificuldade);
      }

      const atual = porDificuldade.get(pull.difficulty) ?? {
        pulls: 0,
        kills: 0,
        firstKillAt: null,
        bestPercent: null,
      };

      atual.pulls++;
      if (pull.kill) {
        atual.kills++;
        if (atual.firstKillAt === null || pull.startedAt < atual.firstKillAt) {
          atual.firstKillAt = pull.startedAt;
        }
      } else if (
        pull.fightPercentage !== null &&
        (atual.bestPercent === null || pull.fightPercentage < atual.bestPercent)
      ) {
        // Melhor wipe: menor % de vida restante. Só entre wipes — uma kill não
        // é "0%", é outra coisa.
        atual.bestPercent = pull.fightPercentage;
      }

      porDificuldade.set(pull.difficulty, atual);
    }

    const raids: RaidProgress[] = [...porRaid.entries()].map(([id, raid]) => ({
      id,
      name: raid.name,
      tier: raid.tier,
      bosses: this.ordenarBosses(raid.bosses, catalogo),
    }));

    // Bosses do tier que ninguém pullou ainda.
    for (const zoneId of tiersAtivos) {
      const doTier = catalogo.zones.get(zoneId) ?? [];
      const semPull = doTier.filter((b) => !bossesVistos.has(b.id));
      if (semPull.length === 0) continue;

      raids.push({
        id: null,
        name: 'Ainda sem pull',
        tier: doTier[0]?.zoneName ?? `Zona ${zoneId}`,
        bosses: semPull
          .sort((a, b) => a.order - b.order)
          .map((b) => ({ encounterId: b.id, name: b.name, byDifficulty: [] })),
      });
    }

    // Ordem: tier, depois a posição do primeiro boss da raid dentro do tier —
    // que é a ordem em que o time entra nas raids.
    return raids.sort((a, b) => {
      const pa = this.primeiroBoss(a, catalogo);
      const pb = this.primeiroBoss(b, catalogo);
      if (pa.zoneId !== pb.zoneId) return pa.zoneId - pb.zoneId;
      return pa.order - pb.order;
    });
  }

  private ordenarBosses(
    bosses: Map<number, Map<number, Agregado>>,
    catalogo: RaidCatalog,
  ): BossProgress[] {
    // A ordem é a da raid, que vem do catálogo — não a ordem em que as pulls
    // apareceram nos logs. Boss pullado primeiro não é o primeiro boss.
    const ordem = (encounterId: number): number =>
      catalogo.encounters.get(encounterId)?.order ?? Number.MAX_SAFE_INTEGER;

    return [...bosses.entries()]
      .sort(([a], [b]) => ordem(a) - ordem(b))
      .map(([encounterId, porDificuldade]) => ({
        encounterId,
        name: catalogo.encounters.get(encounterId)?.name ?? `Boss ${encounterId}`,
        byDifficulty: [...porDificuldade.entries()]
          // Da dificuldade mais alta para a mais baixa: é onde o time está.
          .sort(([a], [b]) => b - a)
          .map(([difficulty, agregado]) => ({
            difficulty,
            pulls: agregado.pulls,
            kills: agregado.kills,
            firstKillAt:
              agregado.firstKillAt === null ? null : new Date(agregado.firstKillAt).toISOString(),
            bestPercent: agregado.bestPercent,
          })),
      }));
  }

  /** Zona e posição do primeiro boss da raid — a chave de ordenação. */
  private primeiroBoss(
    raid: RaidProgress,
    catalogo: RaidCatalog,
  ): { zoneId: number; order: number } {
    const posicoes = raid.bosses
      .map((b) => catalogo.encounters.get(b.encounterId))
      .filter((b): b is NonNullable<typeof b> => b !== undefined);

    const primeiro = posicoes.reduce<(typeof posicoes)[number] | null>(
      (menor, b) => (menor === null || b.order < menor.order ? b : menor),
      null,
    );

    return { zoneId: primeiro?.zoneId ?? Number.MAX_SAFE_INTEGER, order: primeiro?.order ?? 0 };
  }
}
