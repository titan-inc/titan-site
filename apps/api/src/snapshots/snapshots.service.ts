import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { toCharacterKey, toSlug } from '@titan/shared';
import { BlizzardService } from '../blizzard/blizzard.service';
import { loadGuildConfig, type GuildConfig } from '../config/guild.config';
import { GameVersionService } from '../gameversion/gameversion.service';
import { RaiderIoService, type CharacterProgress } from '../raiderio/raiderio.service';
import { WowAuditService } from '../wowaudit/wowaudit.service';
import { SnapshotsRepository, type SnapshotInput } from './snapshots.repository';

export type SnapshotResult =
  | { status: 'aborted'; reason: string }
  | {
      status: 'ok';
      season: number;
      period: number;
      weekInSeason: number;
      recorded: number;
      /** Quantos ficaram sem item level. Lacuna, não zero. */
      withoutItemLevel: number;
      /** false = a season existe mas o M+ dela ainda não abriu no Raider.IO. */
      mythicPlusOpen: boolean;
    };

/**
 * Foto semanal do time de raid.
 *
 * Existe porque as APIs externas respondem "como está agora" e nenhuma responde
 * "como estava em março". A linha do tempo da guilda só existe se a gente
 * gravar — **semana não gravada não volta**. Por isso este job entra antes de
 * qualquer tela que mostre o dado.
 *
 * Tira foto do **time de raid** (WoWAudit), não dos ~590 do roster: é o recorte
 * sobre o qual o raid leader decide, e é de quem existe dado de keys.
 */
@Injectable()
export class SnapshotsService {
  private readonly logger = new Logger(SnapshotsService.name);
  private readonly guild: GuildConfig;

  constructor(
    private readonly blizzard: BlizzardService,
    private readonly wowaudit: WowAuditService,
    private readonly raiderio: RaiderIoService,
    private readonly gameVersion: GameVersionService,
    private readonly repo: SnapshotsRepository,
  ) {
    this.guild = loadGuildConfig();
  }

  /**
   * Diário, e não semanal, de propósito.
   *
   * A foto é sempre do period corrente, e o upsert atualiza a mesma linha —
   * então a semana converge para o valor final até o reset, e a última gravação
   * antes da virada é o fechamento. Rodar uma vez por semana daria o mesmo
   * resultado no caso feliz, mas **perderia a semana inteira** se aquela única
   * execução falhasse.
   */
  @Cron(CronExpression.EVERY_DAY_AT_10AM, { name: 'snapshot-semanal' })
  async snapshotScheduled(): Promise<void> {
    try {
      await this.takeSnapshot();
    } catch (err: unknown) {
      // Exceção aqui viraria unhandled rejection no @nestjs/schedule e
      // derrubaria o processo por causa de uma API de terceiro fora do ar.
      this.logger.error(`Snapshot falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async takeSnapshot(): Promise<SnapshotResult> {
    const season = await this.blizzard.getCurrentSeason();
    const time = await this.wowaudit.getTeamCharacters();

    if (time.length === 0) {
      // Time vazio é falha de leitura, não guilda sem gente. Gravar zero aqui
      // criaria uma semana que parece medida e não foi.
      return this.abort('time do WoWAudit veio vazio');
    }

    // O rótulo é enfeite: se falhar, a season fica sem patch e o resto segue.
    const patch = await this.gameVersion.getPatchLabel();

    await this.repo.upsertSeason({
      id: season.id,
      name: season.name,
      patch,
      firstPeriod: season.firstPeriod,
      periodCount: season.periodCount,
      startedAt: season.startedAt,
    });

    // Keys da semana, por personagem. Uma chamada só para o time inteiro.
    // `count` nulo = o WoWAudit não tem registro daquela semana. Propagar o
    // nulo até o banco é o ponto: zero seria "não fez nada", que é outra coisa.
    const keysPorPersonagem = new Map<string, { count: number | null; highest: number | null }>();
    try {
      for (const k of await this.wowaudit.getWeeklyKeys(season.currentPeriod)) {
        keysPorPersonagem.set(`${k.realmSlug}/${k.nameKey}`, {
          count: k.count,
          highest: k.highest,
        });
      }
    } catch (err: unknown) {
      // Sem keys ainda dá para gravar ilvl. Melhor meia foto que nenhuma.
      this.logger.warn(
        `Keys da semana não vieram: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const progresso = await Promise.all(
      time.map((c) => this.raiderio.getProgress(c.name, c.realm, this.guild.region)),
    );

    const mythicPlusOpen = await this.mythicPlusAberto(season.id, progresso);

    const entradas: SnapshotInput[] = time.map((c, i) => {
      const chave = `${toSlug(c.realm)}/${toCharacterKey(c.name)}`;
      const keys = keysPorPersonagem.get(chave);
      const p = progresso[i];

      return {
        period: season.currentPeriod,
        seasonId: season.id,
        nameKey: toCharacterKey(c.name),
        realmSlug: toSlug(c.realm),
        name: c.name,
        // Nulo quando não deu para medir. NUNCA zero: o gráfico tem que
        // mostrar lacuna, senão vira "a pessoa parou de jogar".
        //
        // Item level é o gear de agora e não pertence a season nenhuma, então
        // continua sendo medido mesmo na pré-season.
        itemLevel: p?.itemLevel ?? null,
        // Estes três são da season, e na pré-season o Raider.IO ainda responde
        // a anterior. Lacuna é a resposta certa: gravar o número da season
        // velha aqui seria dizer que o time chegou nele nesta season.
        mythicPlusScore: mythicPlusOpen ? (p?.mythicPlusScore ?? null) : null,
        keysDone: keys?.count ?? null,
        highestKey: keys?.highest ?? null,
        // Acumulado da season, completo. Diferente de `keysDone`, que é a
        // semana e depende do WoWAudit ter acompanhado.
        seasonRuns: mythicPlusOpen ? (p?.seasonRuns ?? null) : null,
        seasonRunsTimed: mythicPlusOpen ? (p?.seasonRunsTimed ?? null) : null,
      };
    });

    const recorded = await this.repo.saveSnapshots(entradas);
    const withoutItemLevel = entradas.filter((e) => e.itemLevel === null).length;

    this.logger.log(
      `Snapshot period=${season.currentPeriod} season=${season.id} ` +
        `(${patch ?? 'patch?'}, semana ${season.weekInSeason}/${season.periodCount}) — ` +
        `${recorded} personagens, ${withoutItemLevel} sem item level` +
        `${mythicPlusOpen ? '' : ', M+ ainda não aberto (sem score nem chaves da season)'}`,
    );

    return {
      status: 'ok',
      season: season.id,
      period: season.currentPeriod,
      weekInSeason: season.weekInSeason,
      recorded,
      withoutItemLevel,
      mythicPlusOpen,
    };
  }

  /**
   * O M+ desta season já abriu, ou ainda estamos na semana entre patch e season?
   *
   * A season de M+ **sempre abre uma semana depois do patch**. A Blizzard
   * publica a season nova no dia do patch — é dela que sai o `GameSeason` — e
   * nessa semana o Raider.IO ainda responde a season anterior. Sem separar as
   * duas coisas, o acumulado da season velha entra no banco carimbado como
   * season nova, e depois não há como saber qual número era de qual.
   *
   * A verificação é o slug que o próprio Raider.IO nomeia, nunca um offset de
   * uma semana no calendário: a data é promessa, o slug é o que ele está de
   * fato respondendo. Se o slug já pertence a outra season, o M+ desta ainda
   * não abriu; se não pertence a ninguém, esta season o adota e passa a valer.
   */
  private async mythicPlusAberto(
    seasonId: number,
    progresso: CharacterProgress[],
  ): Promise<boolean> {
    const slug = progresso.find((p) => p.season !== null)?.season;
    if (!slug) {
      // Ninguém do time tem perfil de M+ legível. Não há número para gravar de
      // qualquer jeito, e afirmar que a season abriu sem evidência seria pior.
      this.logger.warn('Raider.IO não nomeou season nenhuma; M+ tratado como ainda não aberto');
      return false;
    }

    const dono = await this.repo.findSeasonByRaiderioSlug(slug);
    if (dono) return dono.id === seasonId;

    try {
      await this.repo.setRaiderioSlug(seasonId, slug);
    } catch (err: unknown) {
      // Duas rodadas ao mesmo tempo disputando o mesmo slug. Perder a corrida
      // custa uma rodada de lacuna, que o upsert da próxima corrige.
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Não foi possível marcar ${slug} na season ${seasonId}: ${motivo}`);
      return false;
    }

    this.logger.log(`M+ da season ${seasonId} abriu no Raider.IO como ${slug}`);
    return true;
  }

  /**
   * Traz as chaves das semanas passadas da season corrente.
   *
   * O WoWAudit guarda o histórico por period, então a parte de chaves do
   * relatório nasce com a season inteira em vez de vazia. Item level NÃO é
   * backfillável — o Raider.IO só responde o agora, e ninguém guardou o
   * passado. Por isso semanas antigas ficam com ilvl nulo, que é a verdade.
   *
   * Grava só as chaves, sem tocar no item level já medido da semana corrente.
   */
  async backfillSeasonKeys(): Promise<{ periods: number; entries: number }> {
    const season = await this.blizzard.getCurrentSeason();

    let periods = 0;
    let entries = 0;

    for (let period = season.firstPeriod; period <= season.currentPeriod; period++) {
      try {
        const keys = await this.wowaudit.getWeeklyKeys(period);

        // Semana sem registro não vira linha. Gravar zero ali inventaria "não
        // fez nada" para quem a ferramenta nem observava — e afundaria a média
        // do time no relatório.
        const comDados = keys
          .filter((k): k is typeof k & { count: number } => k.count !== null)
          .map((k) => ({
            nameKey: k.nameKey,
            realmSlug: k.realmSlug,
            name: k.name,
            keysDone: k.count,
            highestKey: k.highest,
          }));

        entries += await this.repo.saveWeeklyKeys(period, season.id, comDados);
        periods++;
      } catch (err: unknown) {
        // Uma semana que falha não pode abortar as outras 19.
        const motivo = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Backfill do period ${period} falhou: ${motivo}`);
      }
    }

    this.logger.log(`Backfill: ${periods} semanas, ${entries} registros de chaves`);
    return { periods, entries };
  }

  private abort(reason: string): SnapshotResult {
    this.logger.warn(`Snapshot abortado sem gravar nada: ${reason}`);
    return { status: 'aborted', reason };
  }
}
