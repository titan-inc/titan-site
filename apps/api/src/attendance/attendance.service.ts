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
  /**
   * Noites que ainda não aconteceram.
   *
   * Contadas à parte de `withoutLog`: raid de sábado que ainda não rolou não é
   * "noite sem log", é noite que não teve o que logar. Somar as duas faria o
   * número de lacunas parecer pior do que é toda semana.
   */
  upcoming: number;
  /** Linhas de presença gravadas. */
  entries: number;
  /** Noites que falharam e ficaram como estavam no banco. */
  failed: number;
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

    // A janela inclui **raid que ainda não aconteceu**, de propósito. É o que
    // torna o congelamento de `signupDeclared` repetível: a noite é relida todo
    // dia até começar, e a última leitura antes das 21h é a que vale. Sem isso,
    // só a rodada das 11h do dia da raid pegaria a declaração — e uma falha do
    // WoWAudit naquela manhã perderia a noite inteira, sem nada para reprocessar.
    const naJanela = planejadas
      .filter((r) => limite === null || r.date >= limite)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (naJanela.length === 0) {
      this.logger.warn('Nenhuma raid planejada na janela; nada a gravar');
      return this.vazio();
    }

    return this.processar(naJanela);
  }

  /**
   * Reprocessa **uma** noite, agora.
   *
   * É a ferramenta do dia seguinte: o raid leader corrige os signups no
   * WoWAudit (quem esqueceu de responder, quem faltou, quem foi banco) e
   * confere o resultado aqui sem esperar a rodada das 11h nem um dev.
   *
   * Vão junto as outras raids marcadas na mesma data, para a regra de noite
   * ambígua responder igual à da rodada diária.
   *
   * Diferente da rodada em lote, falha **lança**: quem apertou o botão precisa
   * saber que a noite não foi atualizada, e não ver a tela velha como se fosse
   * a nova.
   *
   * @returns null se o WoWAudit não tem raid com esse id
   */
  async syncNight(raidId: number): Promise<SyncResult | null> {
    const planejadas = await this.wowaudit.getPlannedRaids();
    const alvo = planejadas.find((r) => r.id === raidId);
    if (!alvo) return null;

    const resultado = await this.processar(planejadas.filter((r) => r.date === alvo.date));
    if (resultado.failed > 0) {
      throw new Error(`a noite ${raidId} (${alvo.date}) não pôde ser reprocessada`);
    }
    return resultado;
  }

  private vazio(): SyncResult {
    return {
      nights: 0,
      withLog: 0,
      withoutLog: 0,
      ambiguous: 0,
      upcoming: 0,
      entries: 0,
      failed: 0,
    };
  }

  /** Cruza signups e logs das noites dadas, em ordem de data, e grava. */
  private async processar(naJanela: PlannedRaid[]): Promise<SyncResult> {
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
    const relatorios = await this.wcl.getRaidParticipation(
      inicio,
      null,
      (startedAt) => datasComRaid.has(this.dataLocal(startedAt)),
      // Só conta pull a partir da hora da raid. Antes dela a guilda faz run de
      // equipamento (heroica com pug) que não é a raid do core, e o log pode
      // trazer as duas no mesmo arquivo — quem sobe é um jogador, e sobe o que
      // gravou. Corte por hora e não por dificuldade: a raid oficial é normal,
      // depois heroica, depois mítica ao longo do patch, e um corte por
      // dificuldade quebraria a cada troca. Atraso não atrapalha: a primeira
      // pull da raid oficial sai sempre depois do horário, nunca antes.
      (pullStartedAt, reportStartedAt) =>
        pullStartedAt >= this.inicioDaRaid(this.dataLocal(reportStartedAt)),
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

    const resultado: SyncResult = { ...this.vazio(), nights: naJanela.length };

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
        else if (this.aindaNaoComecou(raid.date)) resultado.upcoming++;
        else resultado.withoutLog++;
      } catch (err: unknown) {
        // Uma noite que falha não pode abortar as outras 157.
        const motivo = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Noite ${raid.id} (${raid.date}) falhou: ${motivo}`);
        resultado.failed++;
      }
    }

    this.logger.log(
      `Presença: ${resultado.nights} noites — ${resultado.withLog} com log, ` +
        `${resultado.withoutLog} sem log, ${resultado.ambiguous} ambíguas, ` +
        `${resultado.upcoming} a acontecer, ${resultado.failed} com falha, ` +
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

    // Com lista de signup, **o WoWAudit decide quem é da noite**, e o log só
    // diz quem raidou. A lista é o core que o raid leader mantém lá, e é lá
    // que ele corrige no dia seguinte quem esqueceu de responder. Quem está no
    // log e não está na lista é pug, ou alt fora do time — não é da raid do
    // core, e entrar como "Sem confirmar" poluiria a noite de quem é.
    //
    // Sem lista (as noites de 2024–2025), o log é o único fato que existe.
    const temLista = signups.length > 0;

    if (!temLista) {
      for (const [chave, p] of doLog) {
        pessoas.set(chave, {
          name: p.name,
          realm: p.realm,
          signup: null,
          raided: true,
          firstPull: p.firstPull,
          pulls: p.pulls,
        });
      }
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
        hasSignups: temLista,
      },
      entradas,
      this.aindaNaoComecou(raid.date),
      // Podar só com lista: é ela que diz quem é da noite. Sem lista, uma
      // leitura vazia do WoWAudit apagaria a noite inteira.
      temLista,
    );

    return { entries, hasEvidence: temEvidencia };
  }

  /**
   * A raid desta data ainda não começou?
   *
   * É o que decide se o signup lido agora é a **declaração das pessoas** ou já
   * a **correção do raid leader**. Depois da noite o RL edita os status para
   * refletir o que aconteceu, e a partir daí o congelamento tem que parar —
   * senão a declaração original é sobrescrita e "furou" fica indistinguível de
   * "declinou com antecedência".
   *
   * Comparação de instantes, não de datas: o job roda às 11h, mas a rota de ops
   * dispara o sync a qualquer hora, inclusive durante a raid. Por data, uma
   * rodada às 23h do dia da raid ainda pareceria "antes" e apagaria tudo.
   */
  private aindaNaoComecou(date: string): boolean {
    return Date.now() < this.inicioDaRaid(date);
  }

  /**
   * O instante em que a raid daquela data começa, em epoch.
   *
   * O WoWAudit dá só a data de calendário; a hora vem da config da guilda. O
   * offset é calculado para **aquele dia**, não fixo: o Brasil já teve horário
   * de verão e pode voltar a ter, e congelar o offset erraria uma hora durante
   * meses sem nenhum erro aparecer.
   */
  private inicioDaRaid(date: string): number {
    const hora = String(this.guild.raidStartHour).padStart(2, '0');

    // Palpite em UTC, depois corrigido pelo offset real do fuso naquele
    // instante. Duas linhas em vez de uma biblioteca de fuso.
    const palpite = new Date(`${date}T${hora}:00:00Z`).getTime();
    return palpite + this.offsetDoFuso(palpite);
  }

  /** Quanto o fuso da guilda está atrás do UTC naquele instante, em ms. */
  private offsetDoFuso(epoch: number): number {
    // `sv` porque formata como "YYYY-MM-DD HH:mm:ss", que o Date lê como UTC
    // ao trocar o espaço por "T" e anexar "Z".
    const local = new Intl.DateTimeFormat('sv', {
      timeZone: this.guild.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(epoch));

    return epoch - new Date(`${local.replace(' ', 'T')}Z`).getTime();
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
