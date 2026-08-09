import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { toCharacterKey, toSlug, type Region } from '@titan/shared';
import { loadGuildConfig, type GuildConfig } from '../config/guild.config';

/** Membro do roster, só com o que usamos. */
export interface RosterMember {
  /** Nome como a Blizzard exibe, com acento. Para mostrar. */
  name: string;
  /** Identidade, via toCharacterKey(): minúsculas COM acento. Para comparar. */
  nameKey: string;
  realmSlug: string;
  rank: number;
}

/** Personagem de uma conta autenticada. */
export interface AccountCharacter {
  name: string;
  nameKey: string;
  realmSlug: string;
}

/**
 * Season de M+ vigente, com a semana em que estamos.
 *
 * É a fonte AUTORITATIVA de "o tier virou". Patch e season não coincidem: em
 * 2026 o patch 12.1 entra em 11/08 e a season só começa em 18/08. Ancorar em
 * patch zeraria relatório uma semana cedo.
 */
export interface CurrentSeason {
  id: number;
  name: string;
  startedAt: Date;
  /** Primeiro period da season. */
  firstPeriod: number;
  /** Quantos periods a season tem até agora. */
  periodCount: number;
  /** Period corrente do jogo — a semana, já alinhada ao reset da região. */
  currentPeriod: number;
  /** 1 na primeira semana da season. */
  weekInSeason: number;
}

/**
 * Roster + a procedência do dado.
 *
 * Existe porque "roster" e "roster confiável" não são a mesma coisa. Para
 * renderizar página, cache velho serve. Para decidir que alguém saiu da guilda,
 * não serve: ausência causada por falha de API é indistinguível de saída de
 * verdade, e o erro custa o acesso de um membro legítimo.
 */
export interface RosterSnapshot {
  members: RosterMember[];
  /** Quando estes dados vieram da Blizzard de fato. */
  fetchedAt: number;
  /** true = a chamada falhou e isto é o cache anterior. Nunca revogue com isto. */
  stale: boolean;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

/**
 * Cliente das APIs da Blizzard.
 *
 * Único lugar do sistema que fala com a Blizzard — ver Regra 6 do CLAUDE.md.
 * O front nunca chama direto: as credenciais não podem ir para o browser e o
 * cache tem que ficar num lugar só.
 */
@Injectable()
export class BlizzardService implements OnModuleInit {
  private readonly logger = new Logger(BlizzardService.name);
  private readonly guild: GuildConfig;
  private readonly region: Region;

  private clientToken: { value: string; expiresAt: number } | null = null;
  private rosterCache: { members: RosterMember[]; fetchedAt: number } | null = null;

  /** 6h. O roster muda pouco e cada consulta gasta rate limit. */
  private static readonly ROSTER_TTL_MS = 6 * 60 * 60 * 1000;

  constructor() {
    this.guild = loadGuildConfig();
    this.region = this.guild.region;
  }

  /**
   * Aquece token e roster no boot.
   *
   * Medido: o token custa ~1,1s e o roster ~1,0s (337 KB, 590 membros). Nenhum
   * dos dois depende do usuário, então pagar isso durante o callback do login
   * é desperdício — a pessoa fica olhando tela em branco enquanto o servidor
   * busca dados que já poderiam estar em memória.
   *
   * Não bloqueia o boot e não derruba a aplicação se falhar: sem aquecimento o
   * primeiro login só fica lento, o que é degradação aceitável.
   */
  onModuleInit(): void {
    void this.getGuildRoster()
      .then((members) => this.logger.log(`Cache aquecido no boot: ${members.length} membros`))
      .catch((err: unknown) =>
        this.logger.warn(
          `Não foi possível aquecer o cache no boot (o primeiro login ficará lento): ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
  }

  private get apiHost(): string {
    return `https://${this.region}.api.blizzard.com`;
  }

  /**
   * Token de aplicação (client_credentials), para dados públicos como o roster.
   *
   * Diferente do token do usuário: este não representa ninguém, só a aplicação.
   */
  private async getClientToken(): Promise<string> {
    // 60s de margem para não usar um token que expira no meio da chamada.
    if (this.clientToken && this.clientToken.expiresAt > Date.now() + 60_000) {
      return this.clientToken.value;
    }

    const id = process.env.BLIZZARD_CLIENT_ID;
    const secret = process.env.BLIZZARD_CLIENT_SECRET;
    if (!id || !secret) {
      throw new Error(
        'BLIZZARD_CLIENT_ID e BLIZZARD_CLIENT_SECRET são obrigatórios (ver .env.example)',
      );
    }

    const res = await fetch('https://oauth.battle.net/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`Falha ao obter token de aplicação: HTTP ${res.status}`);
    }

    const data = (await res.json()) as TokenResponse;
    this.clientToken = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return data.access_token;
  }

  /**
   * Season de M+ vigente e em que semana dela estamos.
   *
   * Duas armadilhas tratadas aqui:
   *
   * - **a API é reativa, não preditiva.** Em 30/07/2026 a season 18 devolvia
   *   404 mesmo com o patch a 11 dias. Ela só publica quando começa — e é
   *   justamente isso que faz o gap entre patch e season se resolver sozinho.
   * - **`current_season` sozinho não basta.** Se a Blizzard publicar uma season
   *   com `start_timestamp` no futuro, ela ainda não começou.
   *
   * Nunca calcular a próxima como `id + 1`: o index devolve 1..15 e 17, sem 16.
   */
  async getCurrentSeason(): Promise<CurrentSeason> {
    const token = await this.getClientToken();
    const ns = `?namespace=dynamic-${this.region}&locale=en_US`;

    const index = (await this.getJson(
      `${this.apiHost}/data/wow/mythic-keystone/season/index${ns}`,
      token,
    )) as { current_season: { id: number } };

    const season = (await this.getJson(
      `${this.apiHost}/data/wow/mythic-keystone/season/${index.current_season.id}${ns}`,
      token,
    )) as {
      id: number;
      season_name: string;
      start_timestamp: number;
      periods: Array<{ id: number }>;
    };

    const periods = season.periods.map((p) => p.id).sort((a, b) => a - b);
    const firstPeriod = periods[0];
    const currentPeriod = periods[periods.length - 1];

    if (firstPeriod === undefined || currentPeriod === undefined) {
      throw new Error(`Season ${season.id} veio sem periods`);
    }

    if (season.start_timestamp > Date.now()) {
      throw new Error(
        `Season ${season.id} ainda não começou (início em ` +
          `${new Date(season.start_timestamp).toISOString()})`,
      );
    }

    return {
      id: season.id,
      name: season.season_name,
      startedAt: new Date(season.start_timestamp),
      firstPeriod,
      periodCount: periods.length,
      currentPeriod,
      weekInSeason: currentPeriod - firstPeriod + 1,
    };
  }

  /** GET autenticado que devolve JSON, ou lança com o status. */
  private async getJson(url: string, token: string): Promise<unknown> {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} em ${new URL(url).pathname}`);
    return res.json();
  }

  /** Troca o `code` do callback pelo token do usuário. */
  async exchangeCodeForUserToken(code: string, redirectUri: string): Promise<string> {
    const id = process.env.BLIZZARD_CLIENT_ID;
    const secret = process.env.BLIZZARD_CLIENT_SECRET;
    if (!id || !secret) {
      throw new Error('Credenciais da Blizzard ausentes');
    }

    const res = await fetch('https://oauth.battle.net/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Quase sempre redirect_uri divergente da registrada no portal.
      this.logger.error(`Troca de code falhou: HTTP ${res.status} — ${body.slice(0, 200)}`);
      throw new Error(
        `Troca de code falhou com a Blizzard: HTTP ${res.status} — ${body.slice(0, 200)}`,
      );
    }

    const data = (await res.json()) as TokenResponse;
    return data.access_token;
  }

  /** Identidade da conta Battle.net dona do token. */
  async getAccountInfo(userToken: string): Promise<{ battlenetId: string; battletag: string }> {
    const res = await fetch('https://oauth.battle.net/userinfo', {
      headers: { Authorization: `Bearer ${userToken}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`Falha ao ler a conta Battle.net: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { sub: string; battletag?: string };
    return {
      // `sub` é estável; battletag muda quando a pessoa troca.
      battlenetId: String(data.sub),
      battletag: data.battletag ?? 'desconhecido',
    };
  }

  /**
   * Personagens de WoW da conta autenticada. Exige escopo `wow.profile`.
   */
  async getAccountCharacters(userToken: string): Promise<AccountCharacter[]> {
    const url = `${this.apiHost}/profile/user/wow?namespace=profile-${this.region}&locale=en_US`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${userToken}` },
      signal: AbortSignal.timeout(20_000),
    });

    if (res.status === 404) {
      // Conta sem personagem nesta região. Não é erro: é "não é membro".
      return [];
    }

    if (!res.ok) {
      throw new Error(`Falha ao listar personagens: HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      wow_accounts?: Array<{
        characters?: Array<{ name: string; realm: { slug: string } }>;
      }>;
    };

    const characters: AccountCharacter[] = [];
    for (const account of data.wow_accounts ?? []) {
      for (const char of account.characters ?? []) {
        characters.push({
          name: char.name,
          nameKey: toCharacterKey(char.name),
          realmSlug: toSlug(char.realm.slug),
        });
      }
    }
    return characters;
  }

  /**
   * Roster da guilda, com cache. Fonte da verdade para membership.
   *
   * Quem só precisa da lista usa isto. Quem vai *revogar* acesso com base na
   * ausência de alguém precisa saber se o dado é fresco — use
   * `getGuildRosterSnapshot`.
   */
  async getGuildRoster(force = false): Promise<RosterMember[]> {
    return (await this.getGuildRosterSnapshot(force)).members;
  }

  /** Roster com a procedência junto. Ver RosterSnapshot. */
  async getGuildRosterSnapshot(force = false): Promise<RosterSnapshot> {
    if (
      !force &&
      this.rosterCache &&
      Date.now() - this.rosterCache.fetchedAt < BlizzardService.ROSTER_TTL_MS
    ) {
      return { ...this.rosterCache, stale: false };
    }

    const token = await this.getClientToken();
    const url =
      `${this.apiHost}/data/wow/guild/` +
      `${encodeURIComponent(toSlug(this.guild.realm))}/` +
      `${encodeURIComponent(toSlug(this.guild.name))}/roster` +
      `?namespace=profile-${this.region}&locale=en_US`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      // Degradar para o cache velho é melhor que recusar todo mundo: roster
      // vazio faria todos os membros perderem acesso.
      if (this.rosterCache) {
        this.logger.warn(
          `Roster falhou (HTTP ${res.status}); usando cache de ${new Date(this.rosterCache.fetchedAt).toISOString()}`,
        );
        return { ...this.rosterCache, stale: true };
      }
      throw new Error(`Falha ao buscar o roster da guilda: HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      members?: Array<{
        rank: number;
        character: { name: string; realm: { slug: string } };
      }>;
    };

    const members: RosterMember[] = (data.members ?? []).map((m) => ({
      name: m.character.name,
      nameKey: toCharacterKey(m.character.name),
      realmSlug: toSlug(m.character.realm.slug),
      rank: m.rank,
    }));

    this.rosterCache = { members, fetchedAt: Date.now() };
    this.logger.log(`Roster atualizado: ${members.length} membros`);
    return { ...this.rosterCache, stale: false };
  }

  /**
   * URL de consent da Blizzard.
   *
   * @param forceLogin força a Blizzard a pedir credenciais de novo.
   *
   * Sem isso, quem já tem sessão Battle.net no browser é redirecionado de volta
   * na hora, com a MESMA conta, sem ver nenhuma tela. Ótimo para relogar, ruim
   * para trocar de conta: nosso logout não encerra a sessão da Blizzard, então
   * quem tem duas contas fica preso na primeira.
   */
  buildAuthorizeUrl(state: string, redirectUri: string, forceLogin = false): string {
    const id = process.env.BLIZZARD_CLIENT_ID;
    if (!id) throw new Error('BLIZZARD_CLIENT_ID ausente');

    const url = new URL('https://oauth.battle.net/authorize');
    url.searchParams.set('client_id', id);
    // wow.profile é necessário para listar os personagens da conta.
    url.searchParams.set('scope', 'wow.profile');
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    if (forceLogin) url.searchParams.set('prompt', 'login');
    return url.toString();
  }
}
