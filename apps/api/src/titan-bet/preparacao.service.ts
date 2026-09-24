import { Inject, Injectable } from '@nestjs/common';
import type { BetMarketKind } from '@prisma/client';
import type { CatalogoDeRaid, PreparacaoDaRodada, PrepararRodada } from '@titan/shared';
import { BlizzardService, type CurrentSeason } from '../blizzard/blizzard.service';
import { loadGuildTimezone } from '../config/guild.config';
import { WarcraftLogsService, type RaidCatalog } from '../warcraftlogs/warcraftlogs.service';
import { RaidProgressService } from '../raidprogress/raidprogress.service';
import { proximaRodada } from './calendario';
import { faseDaRodada } from './fases';
import { TitanBetRepository, type PlanoDePreparacao } from './titan-bet.repository';

/** A preparação foi recusada pelo estado da rodada; nada mudou. */
export class PreparacaoRecusada extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'PreparacaoRecusada';
  }
}

/** A configuração pedida não é válida (fora do catálogo, mercado errado para o track). */
export class PreparacaoInvalida extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'PreparacaoInvalida';
  }
}

/** O pedaço da Blizzard que a criação usa: o period corrente. */
export interface PeriodoCorrente {
  getCurrentSeason(): Promise<Pick<CurrentSeason, 'currentPeriod'> & Partial<CurrentSeason>>;
}

/** O pedaço do WCL que a preparação usa: o catálogo de raid (D-22). */
export type CatalogoDoWcl = Pick<WarcraftLogsService, 'getRaidCatalog'>;

/**
 * O conteúdo atual da guilda (B2): a zone da atividade de raid real mais
 * recente, pela mesma descoberta da progressão de raid.
 */
export type ConteudoAtual = Pick<RaidProgressService, 'zonaAtual'>;

interface Officer {
  userId: string;
  battletag: string;
}

type Encontrado = NonNullable<
  Awaited<ReturnType<TitanBetRepository['rodadaEmPreparacao']>>
>['encounters'][number];

/**
 * Preparar a semana no Officer Panel (D-45): criar a rodada e escolher o escopo
 * — encounters, track, mercados e Weekly. **Pessoas nunca**: bettors e
 * candidatos são do Ready (D-31, D-32, D-33).
 *
 * Salvar é declarativo: a configuração inteira, como está agora. O service
 * compara com o que existe e aplica só a diferença, com um `BetEvent` dela —
 * remover apaga a linha, e só o evento guarda o que existia (§16.8).
 */
@Injectable()
export class PreparacaoService {
  private readonly timezone = loadGuildTimezone();

  constructor(
    private readonly repo: TitanBetRepository,
    @Inject(BlizzardService) private readonly blizzard: PeriodoCorrente,
    @Inject(WarcraftLogsService) private readonly wcl: CatalogoDoWcl,
    @Inject(RaidProgressService) private readonly atividade: ConteudoAtual,
  ) {}

  /**
   * A rodada da próxima semana: o period que começa no próximo reset — o
   * corrente + 1 —, com cutoff na próxima terça 12:00 no fuso da guilda.
   */
  async criar(officer: Officer): Promise<{ roundId: string }> {
    const season = await this.blizzard.getCurrentSeason();
    const { cutoffAt, opensAt } = proximaRodada(new Date(), this.timezone);
    const period = season.currentPeriod + 1;

    const criada = await this.repo.criarRodada({
      period,
      seasonId: season.id ?? null,
      opensAt,
      cutoffAt,
      officer,
    });
    if (!criada) throw new PreparacaoRecusada(`já existe rodada para o period ${period}`);
    return criada;
  }

  async catalogo(): Promise<CatalogoDeRaid> {
    const [catalogo, zonaAtual] = await Promise.all([
      this.wcl.getRaidCatalog(),
      this.atividade.zonaAtual(),
    ]);
    return {
      zonaAtual,
      zonas: [...catalogo.zones.entries()].map(([zoneId, bosses]) => ({
        zoneId,
        zoneName: bosses[0]?.zoneName ?? '',
        encounters: bosses.map((b) => ({ encounterId: b.id, name: b.name })),
      })),
    };
  }

  async ver(roundId: string): Promise<PreparacaoDaRodada | null> {
    const r = await this.repo.rodadaEmPreparacao(roundId);
    if (!r) return null;
    return {
      roundId: r.id,
      period: r.period,
      opensAt: r.opensAt.toISOString(),
      cutoffAt: r.cutoffAt.toISOString(),
      readyAt: r.readyAt?.toISOString() ?? null,
      weekly: r.markets[0] ? { marketId: r.markets[0].id } : null,
      encounters: r.encounters.map((e) => ({
        roundEncounterId: e.id,
        encounterId: e.encounterId,
        encounterName: e.encounterName,
        zoneName: e.zoneName,
        track: e.track,
        mercados: e.markets.map((m) => ({
          marketId: m.id,
          kind: m.kind as Exclude<BetMarketKind, 'weekly_progression'>,
        })),
      })),
    };
  }

  async salvar(
    roundId: string,
    input: PrepararRodada,
    officer: Officer,
  ): Promise<PreparacaoDaRodada> {
    const rodada = await this.repo.rodadaEmPreparacao(roundId);
    if (!rodada) throw new PreparacaoRecusada(`a rodada ${roundId} não existe`);

    const fase = faseDaRodada(
      {
        readyAt: rodada.readyAt,
        cutoffAt: rodada.cutoffAt,
        auditoria: null,
        temClosingReport: false,
      },
      new Date(),
    );
    if (fase !== 'PREPARATION') {
      throw new PreparacaoRecusada(
        rodada.readyAt
          ? 'a rodada já teve Ready — a configuração congelou (D-31)'
          : 'o cutoff passou sem Ready — a rodada não abre mais',
      );
    }

    const catalogo = await this.wcl.getRaidCatalog();
    validar(input, catalogo);

    const plano = planejar(roundId, officer, input, rodada.encounters, rodada.markets, catalogo);
    if (plano.evento) {
      try {
        await this.repo.aplicarPreparacao(plano);
      } catch (erro: unknown) {
        // O banco é a última palavra: um Ready no meio do caminho cai aqui.
        const motivo = erro instanceof Error ? erro.message : String(erro);
        throw new PreparacaoRecusada(`a preparação não foi gravada: ${motivo}`);
      }
    }
    return (await this.ver(roundId))!;
  }
}

/** O que o contrato já garante, conferido de novo: o service não confia no chamador. */
function validar(input: PrepararRodada, catalogo: RaidCatalog): void {
  for (const e of input.encounters) {
    if (!catalogo.encounters.has(e.encounterId)) {
      throw new PreparacaoInvalida(
        `o encounter ${e.encounterId} não está no catálogo de raid do WCL`,
      );
    }
    if (e.track === 'progressao' && e.mercados.some((m) => m !== 'first_death')) {
      throw new PreparacaoInvalida('boss em progressão só tem First Death (D-29)');
    }
  }
}

// `type`, não `interface`: só o alias entra no JSON do evento sem cast.
type MercadoLogico = {
  encounterId: number | null;
  kind: BetMarketKind;
};

function planejar(
  roundId: string,
  officer: Officer,
  input: PrepararRodada,
  existentes: Encontrado[],
  weeklyExistente: Array<{ id: string }>,
  catalogo: RaidCatalog,
): PlanoDePreparacao {
  const desejados = new Map(input.encounters.map((e) => [e.encounterId, e]));
  const plano: PlanoDePreparacao = {
    roundId,
    officer,
    removerMercados: [],
    removerEncounters: [],
    alterarEncounters: [],
    encountersExistentes: [],
    criarEncounters: [],
    criarMercados: [],
    evento: null,
  };
  const encounters = {
    criados: [] as number[],
    alterados: [] as number[],
    removidos: [] as number[],
  };

  for (const e of existentes) {
    const quer = desejados.get(e.encounterId);
    if (!quer) {
      plano.removerMercados.push(...e.markets.map((m) => m.id));
      plano.removerEncounters.push(e.id);
      encounters.removidos.push(e.encounterId);
      continue;
    }
    plano.encountersExistentes.push([e.encounterId, e.id]);
    const trocouTrack = quer.track !== e.track;
    // Sem marcação da Weekly (D-54), alterar um encounter é trocar o track.
    if (trocouTrack) {
      plano.alterarEncounters.push({ id: e.id, track: quer.track });
      encounters.alterados.push(e.encounterId);
    }
    // Com o track trocado, os mercados saem todos e voltam os desejados: a FK
    // composta propagaria o track novo para um mercado que ele não aceita.
    const ficam = trocouTrack
      ? []
      : e.markets.filter((m) => quer.mercados.includes(m.kind as never));
    plano.removerMercados.push(...e.markets.filter((m) => !ficam.includes(m)).map((m) => m.id));
    for (const kind of quer.mercados) {
      if (!ficam.some((m) => m.kind === kind)) {
        plano.criarMercados.push({ encounterId: e.encounterId, kind, track: quer.track });
      }
    }
  }

  const jaExistem = new Set(existentes.map((e) => e.encounterId));
  for (const e of input.encounters) {
    if (jaExistem.has(e.encounterId)) continue;
    const boss = catalogo.encounters.get(e.encounterId)!;
    plano.criarEncounters.push({
      encounterId: e.encounterId,
      encounterName: boss.name,
      zoneName: boss.zoneName,
      track: e.track,
    });
    encounters.criados.push(e.encounterId);
    for (const kind of e.mercados) {
      plano.criarMercados.push({ encounterId: e.encounterId, kind, track: e.track });
    }
  }

  if (input.weekly && weeklyExistente.length === 0) {
    plano.criarMercados.push({ encounterId: null, kind: 'weekly_progression', track: null });
  }
  if (!input.weekly) plano.removerMercados.push(...weeklyExistente.map((m) => m.id));

  // O evento conta o que mudou de fato, não o que o plano apaga e recria.
  const antes: MercadoLogico[] = [
    ...existentes.flatMap((e) =>
      e.markets.map((m) => ({ encounterId: e.encounterId, kind: m.kind })),
    ),
    ...weeklyExistente.map(() => ({ encounterId: null, kind: 'weekly_progression' as const })),
  ];
  const depois: MercadoLogico[] = [
    ...input.encounters.flatMap((e) =>
      e.mercados.map((kind) => ({ encounterId: e.encounterId, kind })),
    ),
    ...(input.weekly ? [{ encounterId: null, kind: 'weekly_progression' as const }] : []),
  ];
  const mesmo = (a: MercadoLogico) => (b: MercadoLogico) =>
    a.encounterId === b.encounterId && a.kind === b.kind;
  const mercados = {
    criados: depois.filter((m) => !antes.some(mesmo(m))),
    removidos: antes.filter((m) => !depois.some(mesmo(m))),
  };

  const mudou =
    encounters.criados.length + encounters.alterados.length + encounters.removidos.length > 0 ||
    mercados.criados.length + mercados.removidos.length > 0;
  plano.evento = mudou ? { encounters, mercados } : null;
  return plano;
}
