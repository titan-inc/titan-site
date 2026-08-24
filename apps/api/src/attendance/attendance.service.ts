import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { toCharacterKey, toRealmMatchKey } from '@titan/shared';
import {
  chaveDe,
  CharactersRepository,
  indice,
  type PersonagemDaFonte,
} from '../characters/characters.repository';
import { loadGuildConfig, type GuildConfig } from '../config/guild.config';
import {
  WarcraftLogsService,
  type ReportParticipation,
} from '../warcraftlogs/warcraftlogs.service';
import { WowAuditService, type PlannedRaid } from '../wowaudit/wowaudit.service';
import { AttendanceRepository, type AttendanceInput } from './attendance.repository';

/** Uma pessoa da noite, antes de a identidade virar id. */
interface PessoaDaNoite extends PersonagemDaFonte {
  signup: string | null;
  raided: boolean | null;
  firstPull: number | null;
  pulls: number | null;
}

export interface SyncResult {
  /** Noites de raid consideradas na janela. */
  nights: number;
  /** Quantas casaram com pelo menos um log. */
  withLog: number;
  /** Quantas ficaram sem log — "sem dado", não falta. */
  withoutLog: number;
  /** Noites puladas por ambiguidade de data. */
  ambiguous: number;
  /** Linhas de presença gravadas. */
  entries: number;
}

/**
 * Presença de raid: o que a pessoa disse cruzado com o que ela fez.
 *
 * ## Quem manda no calendário
 *
 * A autoridade sobre "isso foi noite de raid" é o **WoWAudit**, não o Warcraft
 * Logs. Quem sobe log é jogador, e sobe o que quiser — existe log de run de
 * alt, de dungeon e de raid avulsa. A guilda declara a raid quando marca; o log
 * é só a evidência do que aconteceu nela.
 *
 * ## A data é a chave, e ela tem fuso
 *
 * O casamento log ↔ raid planejada é por **data de calendário no fuso da
 * guilda**. Medido em 04/08/2026 nos 20 logs mais recentes: por data UTC só 12
 * caem numa data com raid marcada; pelo fuso da guilda, 19 — e o vigésimo é um
 * log que de fato não tem raid marcada. A raid começa 21:00 BRT, que já é o dia
 * seguinte em UTC.
 *
 * ## O realm precisa da chave frouxa
 *
 * O signup diz "Area 52" e o log diz "Area52". Por `toSlug()` isso não casa, e
 * quem raidou de um realm composto viraria "Não Raidou" — acusação de furo
 * contra quem estava lá. Ver `toRealmMatchKey()` e a Regra 6.
 */
@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);
  private readonly guild: GuildConfig;

  constructor(
    private readonly wowaudit: WowAuditService,
    private readonly wcl: WarcraftLogsService,
    private readonly repo: AttendanceRepository,
    private readonly characters: CharactersRepository,
  ) {
    this.guild = loadGuildConfig();
  }

  /**
   * Diário. A noite de ontem só ganha log depois que alguém sobe o arquivo, e
   * isso pode levar dias — então reprocessar todo dia é o que fecha a lacuna.
   */
  @Cron(CronExpression.EVERY_DAY_AT_11AM, { name: 'presenca-de-raid' })
  async syncScheduled(): Promise<void> {
    try {
      // Janela curta na rodada automática: o que muda é o passado recente.
      const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await this.sync(desde);
    } catch (err: unknown) {
      // Exceção aqui viraria unhandled rejection no @nestjs/schedule e
      // derrubaria o processo por causa de uma API de terceiro fora do ar.
      this.logger.error(`Presença falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Cruza signups e logs, e grava.
   *
   * @param desde início da janela. Sem valor, processa o histórico inteiro —
   *   o WoWAudit guarda as raids desde 2024, então dá para backfillar quase
   *   dois anos. É a exceção rara à regra de que histórico não é retroativo:
   *   aqui quem gravou foi a ferramenta, não a gente.
   */
  async sync(desde?: Date): Promise<SyncResult> {
    const planejadas = await this.wowaudit.getPlannedRaids();
    const limite = desde ? this.dataLocal(desde.getTime()) : null;

    const naJanela = planejadas
      .filter((r) => (limite === null || r.date >= limite) && r.date <= this.dataLocal(Date.now()))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (naJanela.length === 0) {
      this.logger.warn('Nenhuma raid planejada na janela; nada a gravar');
      return { nights: 0, withLog: 0, withoutLog: 0, ambiguous: 0, entries: 0 };
    }

    const primeira = naJanela[0];
    if (!primeira) throw new Error('janela sem raids após o filtro');

    // A janela do WCL começa um dia antes: o log é datado pelo seu início, e
    // uma raid que varou a madrugada começa no dia anterior em UTC.
    const inicio = new Date(`${primeira.date}T00:00:00Z`);
    inicio.setUTCDate(inicio.getUTCDate() - 1);

    /** Datas com raid marcada. Só elas interessam. */
    const datasComRaid = new Set(naJanela.map((r) => r.date));

    // Filtrar por data ANTES de baixar o detalhe: a guilda sobe muito log de
    // M+, e baixar tudo estoura a cota do WCL num backfill de dois anos.
    const relatorios = await this.wcl.getRaidParticipation(inicio, null, (startedAt) =>
      datasComRaid.has(this.dataLocal(startedAt)),
    );

    /** data local → relatórios daquela noite. */
    const porData = new Map<string, ReportParticipation[]>();
    for (const rel of relatorios) {
      const data = this.dataLocal(rel.startedAt);
      const lista = porData.get(data);
      if (lista) lista.push(rel);
      else porData.set(data, [rel]);
    }

    /** Quantas raids foram marcadas em cada data. */
    const raidsPorData = new Map<string, number>();
    for (const r of naJanela) raidsPorData.set(r.date, (raidsPorData.get(r.date) ?? 0) + 1);

    const resultado: SyncResult = {
      nights: naJanela.length,
      withLog: 0,
      withoutLog: 0,
      ambiguous: 0,
      entries: 0,
    };

    for (const raid of naJanela) {
      // Duas raids marcadas no mesmo dia: não dá para saber de qual é o log.
      // Gravar a noite sem log é "sem dado"; atribuir ao palpite seria pior.
      const ambigua = (raidsPorData.get(raid.date) ?? 0) > 1;
      if (ambigua) {
        this.logger.warn(
          `${raid.date} tem mais de uma raid marcada; a noite ${raid.id} fica sem log`,
        );
        resultado.ambiguous++;
      }

      const daNoite = ambigua ? [] : (porData.get(raid.date) ?? []);

      try {
        const gravada = await this.gravarNoite(raid, daNoite);
        resultado.entries += gravada.entries;
        // Conta pela evidência, não pela existência do arquivo: log sem pull
        // de boss não diz nada sobre quem raidou.
        if (gravada.hasEvidence) resultado.withLog++;
        else resultado.withoutLog++;
      } catch (err: unknown) {
        // Uma noite que falha não pode abortar as outras 157.
        const motivo = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Noite ${raid.id} (${raid.date}) falhou: ${motivo}`);
      }
    }

    this.logger.log(
      `Presença: ${resultado.nights} noites — ${resultado.withLog} com log, ` +
        `${resultado.withoutLog} sem log, ${resultado.ambiguous} ambíguas, ` +
        `${resultado.entries} registros`,
    );
    return resultado;
  }

  /** Monta e grava uma noite: signups ∪ quem apareceu no log. */
  private async gravarNoite(
    raid: PlannedRaid,
    relatorios: ReportParticipation[],
  ): Promise<{ entries: number; hasEvidence: boolean }> {
    const signups = await this.wowaudit.getRaidSignups(raid.id);

    /**
     * Vários logs na mesma noite viram um só, por união.
     *
     * Acontece de verdade (18/06/2026 tem dois). Quem esteve em qualquer um
     * deles esteve na raid; escolher um relatório descartaria presença real.
     */
    const doLog = new Map<
      string,
      { name: string; realm: string; firstPull: number; pulls: number }
    >();
    let bossPulls = 0;

    for (const rel of relatorios) {
      bossPulls += rel.bossPulls;
      for (const p of rel.players) {
        const chave = this.chave(p.name, p.realm);
        const atual = doLog.get(chave);
        if (atual) {
          atual.pulls += p.pulls;
          atual.firstPull = Math.min(atual.firstPull, p.firstPull);
        } else {
          doLog.set(chave, {
            name: p.name,
            realm: p.realm,
            firstPull: p.firstPull,
            pulls: p.pulls,
          });
        }
      }
    }

    /**
     * Existe evidência sobre quem raidou?
     *
     * A pergunta **não** é "existe log" — é "existe pull de boss no log".
     * Encontrado no dado real: a noite de 21/07/2026 tem um log de 10 minutos,
     * sem zona e com zero pull. Contando pela existência do arquivo, as 22
     * pessoas da noite viravam "Não Raidou" de uma vez — a raid inteira acusada
     * de furar por causa de um log que ninguém chegou a usar.
     *
     * Log sem pull não é prova de ausência, é ausência de prova.
     */
    const temEvidencia = bossPulls > 0;
    const pessoas = new Map<string, PessoaDaNoite>();

    for (const s of signups) {
      const chave = this.chave(s.name, s.realm);
      const participacao = doLog.get(chave);

      pessoas.set(chave, {
        name: s.name,
        // O realm do signup é a forma que a guilda reconhece ("Area 52"),
        // melhor para exibir que a do WCL ("Area52"). A identidade já existe
        // no roster, então essa grafia não sobrescreve a da Blizzard —
        // `resolver()` só preenche o que faltar.
        realm: s.realm,
        signup: s.status,
        // Sem evidência, `raided` é NULL — e null não é false. Noite sem pull
        // registrada é noite sem informação, não noite em que todo mundo furou.
        raided: temEvidencia ? participacao !== undefined : null,
        firstPull: participacao?.firstPull ?? null,
        pulls: participacao?.pulls ?? null,
      });
    }

    // Quem apareceu no log sem ter feito signup. Existe de verdade — na noite
    // de 28/07 são três pessoas.
    for (const [chave, p] of doLog) {
      if (pessoas.has(chave)) continue;

      pessoas.set(chave, {
        name: p.name,
        realm: p.realm,
        signup: null,
        raided: true,
        firstPull: p.firstPull,
        pulls: p.pulls,
      });
    }

    // Uma chamada só para a noite inteira — resolver por linha seriam dezenas
    // de idas ao banco por noite.
    const identidades = await this.characters.resolverVarios([...pessoas.values()]);
    const entradas: AttendanceInput[] = [...pessoas.values()].map((p) => {
      const characterId = identidades.get(indice(chaveDe(p)));
      if (!characterId) {
        // Não deveria acontecer: toda pessoa de `pessoas` passou por
        // `resolverVarios` antes desta chamada.
        throw new Error(`identidade não resolvida para ${p.name}-${p.realm}`);
      }

      return {
        characterId,
        signup: p.signup,
        raided: p.raided,
        firstPull: p.firstPull,
        pulls: p.pulls,
      };
    });

    const entries = await this.repo.saveNight(
      {
        id: raid.id,
        date: raid.date,
        title: raid.title,
        instance: raid.instance,
        difficulty: raid.difficulty,
        optional: raid.optional,
        seasonId: raid.seasonId,
        reportCodes: relatorios.map((r) => r.code),
        bossPulls: temEvidencia ? bossPulls : null,
        // Lista vazia é ausência de dado, não ausência de gente: o WoWAudit só
        // devolve signups a partir de 2026.
        hasSignups: signups.length > 0,
      },
      entradas,
    );

    return { entries, hasEvidence: temEvidencia };
  }

  /** Identidade que atravessa as duas fontes: nome com acento + realm frouxo. */
  private chave(name: string, realm: string): string {
    return `${toRealmMatchKey(realm)}/${toCharacterKey(name)}`;
  }

  /**
   * Data de calendário de um instante, no fuso da guilda.
   *
   * `en-CA` porque devolve exatamente `YYYY-MM-DD`, que é o formato do
   * WoWAudit e ordena como string.
   */
  private dataLocal(epoch: number): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.guild.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(epoch));
  }
}
