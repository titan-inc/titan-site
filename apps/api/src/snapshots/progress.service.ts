import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  toCharacterKey,
  toSlug,
  type ProgressReport,
  type ProgressRow,
  type SeasonOption,
} from '@titan/shared';
import { WowAuditService } from '../wowaudit/wowaudit.service';
import { SnapshotsRepository } from './snapshots.repository';

/** Quantas seasons aparecem no seletor. */
const SEASONS_NO_SELETOR = 6;

/** Média que ignora ausência — sem dado não é zero. Null se ninguém tem. */
function media(valores: Array<number | null>): number | null {
  const presentes = valores.filter((v): v is number => v !== null);
  if (presentes.length === 0) return null;
  return presentes.reduce((a, b) => a + b, 0) / presentes.length;
}

/** Diferença que só existe quando os dois lados existem. */
function delta(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

/**
 * Relatório de progressão da season.
 *
 * Lê o que o job de snapshot gravou — é o pagamento do que foi guardado semana
 * a semana. A única API externa que ele consulta é o WoWAudit, e só para saber
 * quem ainda está no time; ver `somenteDoTime()`.
 */
@Injectable()
export class ProgressService {
  private readonly logger = new Logger(ProgressService.name);

  constructor(
    private readonly repo: SnapshotsRepository,
    private readonly wowaudit: WowAuditService,
  ) {}

  /**
   * @param seasonId season pedida; sem ela, a mais recente gravada.
   */
  async getReport(seasonId?: number): Promise<ProgressReport | null> {
    const seasons = await this.repo.listSeasons(SEASONS_NO_SELETOR);
    if (seasons.length === 0) return null;

    const escolhida = seasonId ? await this.repo.findSeason(seasonId) : (seasons[0] ?? null);

    if (!escolhida) throw new NotFoundException(`Season ${seasonId} não foi gravada`);

    const snapshots = await this.repo.findSeasonSnapshots(escolhida.id);
    if (snapshots.length === 0) return null;

    const periods = [...new Set(snapshots.map((s) => s.period))].sort((a, b) => a - b);
    const atual = periods[periods.length - 1];
    const anterior = periods.length > 1 ? periods[periods.length - 2] : null;

    if (atual === undefined) return null;

    // Só a season mais recente tem "semana corrente". Numa season passada a
    // última semana gravada é história, e o time de hoje não a descreve.
    const corrente = escolhida.id === seasons[0]?.id;
    const daSemana = await this.somenteDoTime(
      snapshots.filter((s) => s.period === atual),
      corrente,
    );

    // Média do time na semana. É o que o raid leader compara contra cada um.
    const average = {
      itemLevel: media(daSemana.map((s) => s.itemLevel)),
      keysDone: media(daSemana.map((s) => s.keysDone)),
    };

    const rows: ProgressRow[] = daSemana.map((s) => {
      const antes = anterior
        ? (snapshots.find(
            (o) => o.period === anterior && o.nameKey === s.nameKey && o.realmSlug === s.realmSlug,
          ) ?? null)
        : null;

      return {
        name: s.name,
        realm: s.realmSlug,
        itemLevel: s.itemLevel,
        itemLevelDelta: delta(s.itemLevel, antes?.itemLevel ?? null),
        itemLevelVsAverage: delta(s.itemLevel, average.itemLevel),
        keysDone: s.keysDone,
        keysVsAverage: delta(s.keysDone, average.keysDone),
        // Acumulado vem do Raider.IO, não da soma das nossas semanas: ele
        // cobre a season inteira, e a nossa só começa no tracking do WoWAudit.
        keysInSeason: s.seasonRuns,
        keysInSeasonTimed: s.seasonRunsTimed,
        highestKey: s.highestKey,
      };
    });

    const opcao = (s: (typeof seasons)[number]): SeasonOption => ({
      id: s.id,
      patch: s.patch,
      name: s.name,
    });

    return {
      season: opcao(escolhida),
      availableSeasons: seasons.map(opcao),
      period: atual,
      weekInSeason: atual - escolhida.firstPeriod + 1,
      periodCount: escolhida.periodCount,
      average,
      rows,
    };
  }

  /**
   * Tira da foto corrente quem já saiu do time.
   *
   * O job só faz upsert, nunca remove: quem entrou no WoWAudit e saiu depois
   * deixa para trás a linha da semana. Ela não é erro — descreve a semana — mas
   * o relatório se propõe a descrever o **time de hoje**, e o resíduo entra na
   * média e desloca o `vs média` de todo mundo, que é a coluna sobre a qual o
   * raid leader decide.
   *
   * **Semana passada nunca é filtrada**: quem estava no time naquela semana
   * estava no time naquela semana. Reescrever isso contraria a Regra 7.
   *
   * Não custa salto de rede: `getTeamCharacters()` tem cache no service, e a
   * aba de roster já o mantém quente.
   */
  private async somenteDoTime<T extends { nameKey: string; realmSlug: string }>(
    daSemana: T[],
    corrente: boolean,
  ): Promise<T[]> {
    if (!corrente) return daSemana;

    let noTime: Set<string>;
    try {
      const time = await this.wowaudit.getTeamCharacters();
      noTime = new Set(time.map((c) => `${toSlug(c.realm)}/${toCharacterKey(c.name)}`));
    } catch (err: unknown) {
      // Regra 6: falha de API externa não derruba página. Sem a lista não dá
      // para filtrar, então sai sem filtro — uma linha a mais é o que já
      // acontece hoje, e é melhor que uma tela que não abre.
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Time do WoWAudit não veio; relatório sai sem filtro: ${motivo}`);
      return daSemana;
    }

    const doTime = daSemana.filter((s) => noTime.has(`${s.realmSlug}/${s.nameKey}`));

    // Zerar a semana inteira é sintoma de chave divergente ou de time vazio na
    // resposta, nunca de guilda sem ninguém — mesma leitura que o job faz ao
    // abortar. Entregar tabela vazia ao raid leader seria pior que não filtrar.
    if (doTime.length === 0 && daSemana.length > 0) {
      this.logger.warn(
        `Nenhum dos ${daSemana.length} personagens da semana casou com o time do WoWAudit; ` +
          `relatório sai sem filtro`,
      );
      return daSemana;
    }

    const foraDoTime = daSemana.length - doTime.length;
    if (foraDoTime > 0) {
      this.logger.log(`${foraDoTime} personagem(ns) fora do time atual saíram da foto corrente`);
    }

    return doTime;
  }
}
