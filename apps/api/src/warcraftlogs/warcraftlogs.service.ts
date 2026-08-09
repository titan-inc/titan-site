import { Injectable, Logger } from '@nestjs/common';
import { toSlug } from '@titan/shared';
import { loadGuildConfig, type GuildConfig } from '../config/guild.config';

/** Boss de uma zona de raid, já com a zona a que pertence. */
export interface RaidEncounter {
  id: number;
  name: string;
  /** Zona do WCL — o **tier**, que pode juntar várias raids. */
  zoneId: number;
  zoneName: string;
  /** Posição na lista da zona. É a ordem da raid. */
  order: number;
}

/** Catálogo de bosses de raid do WCL, para classificar o que vem dos logs. */
export interface RaidCatalog {
  /** encounterId → boss. Contém **só** encounters de zona de raid. */
  encounters: Map<number, RaidEncounter>;
  /** zoneId → bosses da zona, na ordem. */
  zones: Map<number, RaidEncounter[]>;
  /** difficultyId → nome ("Mythic", "Heroic"...). */
  difficultyNames: Map<number, string>;
}

/** Uma pull de boss num log da guilda. */
export interface RaidPull {
  encounterId: number;
  difficulty: number;
  kill: boolean;
  /** % de vida do boss no fim da pull. Menor é melhor. */
  fightPercentage: number | null;
  /** Epoch ms absoluto (o WCL dá o offset dentro do relatório). */
  startedAt: number;
  /** Instância do jogo — é isto que separa as raids dentro de um tier. */
  gameZoneId: number | null;
  gameZoneName: string | null;
}

export interface WclFight {
  encounterID: number;
  name: string;
  difficulty: number | null;
  kill: boolean | null;
  fightPercentage: number | null;
  startTime: number;
  gameZone: { id: number; name: string } | null;
}

export interface WclReport {
  code: string;
  startTime: number;
  fights: WclFight[];
}

/**
 * Fica com as pulls de boss de **raid** e descarta o resto.
 *
 * Três coisas chegam misturadas no mesmo relatório, e as três precisam sair:
 *
 * - `encounterID = 0` é **trash**. Confirmado em log real: na noite de 28/07,
 *   "L'ura" aparece com 2 pulls e não é boss nenhum.
 * - `difficulty = null` é a mesma coisa por outro campo.
 * - encounter fora do catálogo de raid é **dungeon de M+**. Este é o filtro que
 *   não dá para trocar por dificuldade: boss de dungeon aparece em difficulty 5
 *   e 3, exatamente como boss de raid. Na season 17 são 554 pulls de dungeon
 *   dentro dos relatórios da guilda.
 *
 * Filtrar relatório inteiro também não serve: um log de raid contém dungeon, e
 * um log marcado como dungeon contém boss de raid. É pull a pull.
 */
export function toRaidPulls(reports: WclReport[], catalog: RaidCatalog): RaidPull[] {
  const pulls: RaidPull[] = [];

  for (const rel of reports) {
    for (const f of rel.fights) {
      if (f.encounterID === 0) continue;
      if (f.difficulty === null) continue;
      if (!catalog.encounters.has(f.encounterID)) continue;

      pulls.push({
        encounterId: f.encounterID,
        difficulty: f.difficulty,
        kill: f.kill === true,
        fightPercentage: f.fightPercentage,
        // `fights.startTime` é offset dentro do relatório, não epoch.
        startedAt: rel.startTime + f.startTime,
        gameZoneId: f.gameZone?.id ?? null,
        gameZoneName: f.gameZone?.name ?? null,
      });
    }
  }

  return pulls;
}

/**
 * Dificuldade de dungeon. Uma zona que tem isto é M+, não raid.
 *
 * Serve para montar o catálogo só com raid — e é o que **não** dá para fazer
 * filtrando pull por dificuldade: boss de dungeon aparece em difficulty 5 e 3
 * também, exatamente como boss de raid.
 */
const DIFICULDADE_DUNGEON = 10;

/** TTL do catálogo de zonas. Muda uma vez por patch, no máximo. */
const CATALOGO_TTL_MS = 12 * 60 * 60 * 1000;

/** Quantos relatórios pedir por query. Aliases numa query só, não N requests. */
const LOTE = 25;

/** Quantas queries de lote em paralelo. */
const CONCORRENCIA = 3;

/**
 * Cliente do Warcraft Logs (API v2, GraphQL). Só o Nest fala com ele — Regra 6.
 *
 * Autentica por **client credentials**: o site consulta em nome dele mesmo, não
 * do jogador. O fluxo de usuário (`/api/v2/user`) não é o nosso caso.
 *
 * Rate limit é por pontos, não por request: 3600/hora, e uma noite inteira
 * custa ~1 ponto. Medido em 04/08/2026: os 134 relatórios de uma season inteira
 * saem em ~1s e ~130 pontos. **O cache aqui não existe para economizar cota** —
 * existe para a página não depender do WCL estar de pé.
 */
@Injectable()
export class WarcraftLogsService {
  private readonly logger = new Logger(WarcraftLogsService.name);
  private readonly guild: GuildConfig;

  private static readonly TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
  private static readonly API_URL = 'https://www.warcraftlogs.com/api/v2/client';

  private token: { value: string; expiresAt: number } | null = null;
  private guildId: number | null = null;
  private catalogo: { data: RaidCatalog; fetchedAt: number } | null = null;

  constructor() {
    this.guild = loadGuildConfig();
  }

  /**
   * Bosses de raid conhecidos pelo WCL, de todas as expansões.
   *
   * É o que responde "esta pull é de raid?" — e a resposta **não** sai da
   * dificuldade. Um log de M+ traz boss de dungeon em difficulty 5 e 3, iguais
   * aos de raid; o que os separa é o encounter não estar em zona de raid.
   * Sem isto, 554 pulls de dungeon entravam na progressão do tier.
   */
  async getRaidCatalog(): Promise<RaidCatalog> {
    if (this.catalogo && Date.now() - this.catalogo.fetchedAt < CATALOGO_TTL_MS) {
      return this.catalogo.data;
    }

    const data = await this.query<{
      worldData: {
        expansions: Array<{
          zones: Array<{
            id: number;
            name: string;
            difficulties: Array<{ id: number; name: string }>;
            encounters: Array<{ id: number; name: string }>;
          }>;
        }>;
      };
    }>(`query {
      worldData {
        expansions {
          zones {
            id
            name
            difficulties { id name }
            encounters { id name }
          }
        }
      }
    }`);

    const encounters = new Map<number, RaidEncounter>();
    const zones = new Map<number, RaidEncounter[]>();
    const difficultyNames = new Map<number, string>();

    for (const expansao of data.worldData.expansions) {
      for (const zona of expansao.zones) {
        if (zona.difficulties.some((d) => d.id === DIFICULDADE_DUNGEON)) continue;

        for (const d of zona.difficulties) difficultyNames.set(d.id, d.name);

        const bosses = zona.encounters.map((e, i) => ({
          id: e.id,
          name: e.name,
          zoneId: zona.id,
          zoneName: zona.name,
          order: i,
        }));

        zones.set(zona.id, bosses);
        for (const b of bosses) encounters.set(b.id, b);
      }
    }

    this.catalogo = { data: { encounters, zones, difficultyNames }, fetchedAt: Date.now() };
    this.logger.log(`Catálogo do WCL: ${zones.size} zonas de raid, ${encounters.size} bosses`);
    return this.catalogo.data;
  }

  /** Todas as pulls de boss de raid da guilda numa janela de tempo. */
  async getRaidPulls(from: Date, to: Date | null): Promise<RaidPull[]> {
    const catalogo = await this.getRaidCatalog();
    return toRaidPulls(await this.fetchReports(from, to), catalogo);
  }

  /** Lista os relatórios da janela e busca o detalhe de cada um. */
  private async fetchReports(from: Date, to: Date | null): Promise<WclReport[]> {
    const codes = await this.listReportCodes(from, to);
    if (codes.length === 0) return [];

    const lotes: string[][] = [];
    for (let i = 0; i < codes.length; i += LOTE) lotes.push(codes.slice(i, i + LOTE));

    const relatorios: WclReport[] = [];
    for (let i = 0; i < lotes.length; i += CONCORRENCIA) {
      const respostas = await Promise.all(
        lotes.slice(i, i + CONCORRENCIA).map((lote) => this.fetchReportBatch(lote)),
      );
      for (const r of respostas) relatorios.push(...r);
    }

    return relatorios;
  }

  /** Códigos dos relatórios da guilda na janela, paginando até o fim. */
  private async listReportCodes(from: Date, to: Date | null): Promise<string[]> {
    const guildId = await this.getGuildId();
    const codes: string[] = [];

    for (let page = 1; ; page++) {
      const data = await this.query<{
        reportData: {
          reports: { has_more_pages: boolean; data: Array<{ code: string }> };
        };
      }>(
        `query($guild:Int!, $start:Float!, $end:Float, $page:Int!) {
          reportData {
            reports(guildID: $guild, startTime: $start, endTime: $end, limit: 100, page: $page) {
              has_more_pages
              data { code }
            }
          }
        }`,
        { guild: guildId, start: from.getTime(), end: to?.getTime() ?? null, page },
      );

      const pagina = data.reportData.reports;
      for (const r of pagina.data) codes.push(r.code);
      if (!pagina.has_more_pages) break;
    }

    return codes;
  }

  /**
   * Detalhe de vários relatórios numa query só, por alias.
   *
   * Um request por relatório levaria ~30s para uma season; em lotes de 25 são
   * ~1s. Vale a query montada à mão.
   */
  private async fetchReportBatch(codes: string[]): Promise<WclReport[]> {
    // O código vai concatenado na query (alias não aceita variável), então
    // nada que não seja código de relatório pode passar daqui.
    const seguros = codes.filter((c) => /^[A-Za-z0-9]+$/.test(c));
    if (seguros.length !== codes.length) {
      this.logger.warn(`Ignorados ${codes.length - seguros.length} códigos de relatório suspeitos`);
    }
    if (seguros.length === 0) return [];

    const campos = `code
      startTime
      fights {
        encounterID
        name
        difficulty
        kill
        fightPercentage
        startTime
        gameZone { id name }
      }`;

    const data = await this.query<{ reportData: Record<string, WclReport | null> }>(
      `query { reportData {
        ${seguros.map((c, i) => `r${i}: report(code: "${c}") { ${campos} }`).join('\n')}
      } }`,
    );

    // Relatório apagado entre a listagem e o detalhe volta null. Não é erro.
    return Object.values(data.reportData).filter((r): r is WclReport => r !== null);
  }

  /**
   * Id da guilda no WCL, resolvido pelo nome/realm/região da configuração.
   *
   * Resolvido em vez de hardcodado: o número não significa nada para ninguém e
   * amarraria o código a uma guilda só. O realm vai por `toSlug()` — Regra 6,
   * realm é o caso em que tirar acento é o certo.
   */
  private async getGuildId(): Promise<number> {
    if (this.guildId !== null) return this.guildId;

    const data = await this.query<{
      guildData: { guild: { id: number } | null };
    }>(
      `query($name:String!, $server:String!, $region:String!) {
        guildData {
          guild(name: $name, serverSlug: $server, serverRegion: $region) { id }
        }
      }`,
      {
        name: this.guild.name,
        server: toSlug(this.guild.realm),
        region: this.guild.region.toUpperCase(),
      },
    );

    const guild = data.guildData.guild;
    if (!guild) {
      throw new Error(
        `Warcraft Logs não conhece a guilda "${this.guild.name}" em ` +
          `${toSlug(this.guild.realm)}/${this.guild.region.toUpperCase()}`,
      );
    }

    this.guildId = guild.id;
    this.logger.log(`Guilda no WCL: ${this.guild.name} = ${guild.id}`);
    return guild.id;
  }

  /** Token de aplicação. Vale ~1 ano, mas a margem é barata. */
  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const id = process.env.WARCRAFTLOGS_CLIENT_ID;
    const secret = process.env.WARCRAFTLOGS_CLIENT_SECRET;
    if (!id || !secret) {
      throw new Error(
        'WARCRAFTLOGS_CLIENT_ID e WARCRAFTLOGS_CLIENT_SECRET são obrigatórios (ver .env.example)',
      );
    }

    const res = await fetch(WarcraftLogsService.TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) throw new Error(`Falha ao autenticar no Warcraft Logs: HTTP ${res.status}`);

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  /**
   * Uma query GraphQL.
   *
   * GraphQL responde 200 com `errors` no corpo — checar só o status deixaria
   * passar resposta vazia como se fosse sucesso.
   */
  private async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const token = await this.getToken();

    const res = await fetch(WarcraftLogsService.API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) throw new Error(`Warcraft Logs HTTP ${res.status}`);

    const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };

    if (body.errors?.length) {
      throw new Error(`Warcraft Logs: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    if (!body.data) throw new Error('Warcraft Logs respondeu sem dados');

    return body.data;
  }
}
