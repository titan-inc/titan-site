import { Injectable, Logger } from '@nestjs/common';
import { signupStatusSchema, toCharacterKey, toSlug, type SignupStatus } from '@titan/shared';

/** Personagem do time, já traduzido do formato do WoWAudit. */
export interface TeamCharacter {
  name: string;
  realm: string;
  wowClass: string;
  role: string;
}

/** Keys que um personagem fechou numa semana. */
export interface WeeklyKeys {
  nameKey: string;
  realmSlug: string;
  name: string;
  /**
   * Quantas keys fechou, ou **null quando o WoWAudit não tem registro** da
   * semana para esse personagem.
   *
   * A distinção é essencial: null e 0 são coisas diferentes. O histórico só
   * existe a partir de quando o time passou a ser acompanhado — na season 17,
   * 86 de 440 pares personagem×semana não têm registro. Tratar isso como zero
   * afunda a média do time e inventa "não fez nada" para quem a ferramenta
   * simplesmente não observava.
   */
  count: number | null;
  /** Maior nível. Distingue 3 keys +10 de 3 keys +2. */
  highest: number | null;
}

/** Noite de raid marcada no calendário da guilda. */
export interface PlannedRaid {
  /** Id no WoWAudit. */
  id: number;
  /** Data de calendário, "2026-07-28". Já vem no fuso da guilda. */
  date: string;
  title: string;
  instance: string;
  difficulty: string;
  /** Run extra / de alt. Conta separado da raid do core. */
  optional: boolean;
  seasonId: number | null;
}

/** Quem respondeu o quê no signup de uma noite. */
export interface RaidSignup {
  name: string;
  realm: string;
  nameKey: string;
  realmSlug: string;
  status: SignupStatus;
}

/** TTL do cache. O raid leader mexe no time raramente. */
const TEAM_TTL_MS = 60 * 60 * 1000;

/**
 * Cliente do WoWAudit. Chamado só pelo Nest — ver Regra 6 do CLAUDE.md.
 *
 * ARMADILHA: `https://wowaudit.com/api/v1/...` **não** é a API. É a página de
 * marketing em HTML, e responde 200 para qualquer caminho, inclusive sem chave
 * nenhuma. Quem sondar por status code conclui que autenticou. A API real é
 * `/v1` e devolve `application/json`.
 */
@Injectable()
export class WowAuditService {
  private readonly logger = new Logger(WowAuditService.name);
  private static readonly BASE = 'https://wowaudit.com/v1';

  private cache: { characters: TeamCharacter[]; fetchedAt: number } | null = null;

  /**
   * Time de raid, com cache. Devolve o último dado bom se a chamada falhar.
   *
   * Lista curada à mão pelo raid leader — é a resposta para "quem está no time
   * hoje", que o rank da guilda não responde.
   */
  async getTeamCharacters(force = false): Promise<TeamCharacter[]> {
    if (!force && this.cache && Date.now() - this.cache.fetchedAt < TEAM_TTL_MS) {
      return this.cache.characters;
    }

    const key = process.env.WOW_AUDIT_KEY;
    if (!key) {
      throw new Error('WOW_AUDIT_KEY não configurada. Ver .env.example.');
    }

    let res: Response;
    try {
      res = await fetch(`${WowAuditService.BASE}/characters`, {
        headers: { Authorization: `Bearer ${key}` },
      });
    } catch (err: unknown) {
      return this.fallback(err instanceof Error ? err.message : String(err));
    }

    if (!res.ok) return this.fallback(`HTTP ${res.status}`);

    const body = (await res.json()) as Array<{
      name: string;
      realm: string;
      class: string;
      role: string;
    }>;

    const characters = body.map((c) => ({
      name: c.name,
      realm: c.realm,
      wowClass: c.class,
      role: c.role,
    }));

    this.cache = { characters, fetchedAt: Date.now() };
    this.logger.log(`Time do WoWAudit atualizado: ${characters.length} personagens`);
    return characters;
  }

  /**
   * Noites de raid marcadas, incluindo as passadas.
   *
   * `?include_past=true` é obrigatório: sem ele o endpoint devolve **só as
   * futuras**, e a sondagem conclui que não há histórico. Com ele vêm 158 raids
   * desde 2024-09-24 — dá para backfillar quase dois anos de presença.
   *
   * `status` vem `"Planned"` em 100% das raids, inclusive nas de 2024. O campo
   * nunca é atualizado; **não usar como sinal de "essa raid aconteceu"**. Quem
   * responde isso é a existência do log.
   */
  async getPlannedRaids(): Promise<PlannedRaid[]> {
    const body = await this.get<{
      raids: Array<{
        id: number;
        title: string;
        date: string;
        instance: string;
        difficulty: string;
        optional: boolean;
        season_id: number | null;
      }>;
    }>('raids?include_past=true');

    return body.raids.map((r) => ({
      id: r.id,
      date: r.date,
      title: r.title,
      instance: r.instance,
      difficulty: r.difficulty,
      optional: r.optional,
      seasonId: r.season_id,
    }));
  }

  /**
   * Signups de uma noite.
   *
   * O status é **auto-declarado** e não binário: `Standby` é o banco que a
   * própria pessoa marcou, e `Late` é ela avisando que chega atrasada. Isso
   * encolhe o trabalho manual do raid leader para um caso só.
   */
  async getRaidSignups(raidId: number): Promise<RaidSignup[]> {
    const body = await this.get<{
      signups?: Array<{
        character: { name: string; realm: string };
        status: string;
      }>;
    }>(`raids/${raidId}`);

    return (body.signups ?? []).map((s) => {
      const parsed = signupStatusSchema.safeParse(s.status);

      if (!parsed.success) {
        // Status novo no WoWAudit. Cair em Unknown mantém a pessoa fora do
        // quadrante ambíguo — errar para "não prometeu nada" não acusa
        // ninguém de furar. Mas o log tem que aparecer, senão um status
        // significativo (um "Bench" novo, por exemplo) vira rotação para sempre.
        this.logger.warn(
          `Status de signup desconhecido no WoWAudit: "${s.status}" — tratado como Unknown`,
        );
      }

      return {
        name: s.character.name,
        realm: s.character.realm,
        nameKey: toCharacterKey(s.character.name),
        realmSlug: toSlug(s.character.realm),
        status: parsed.success ? parsed.data : 'Unknown',
      };
    });
  }

  /** GET autenticado que devolve JSON, ou lança. */
  private async get<T>(path: string): Promise<T> {
    const key = process.env.WOW_AUDIT_KEY;
    if (!key) throw new Error('WOW_AUDIT_KEY não configurada. Ver .env.example.');

    const res = await fetch(`${WowAuditService.BASE}/${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) throw new Error(`WoWAudit HTTP ${res.status} em /${path}`);

    // A página de marketing responde 200 em HTML para qualquer caminho. Sem
    // esta checagem, `res.json()` falharia com erro de parse que não sugere
    // que a URL é que está errada.
    const tipo = res.headers.get('content-type') ?? '';
    if (!tipo.includes('json')) {
      throw new Error(`WoWAudit devolveu ${tipo} em /${path} — isso é a página, não a API`);
    }

    return (await res.json()) as T;
  }

  private fallback(reason: string): TeamCharacter[] {
    if (this.cache) {
      const desde = new Date(this.cache.fetchedAt).toISOString();
      this.logger.warn(`WoWAudit falhou (${reason}); usando cache de ${desde}`);
      return this.cache.characters;
    }
    throw new Error(`WoWAudit falhou e não há cache anterior: ${reason}`);
  }

  /**
   * Keys fechadas por cada personagem numa semana do jogo.
   *
   * O Raider.IO **não serve** para isto: `mythic_plus_recent_runs` devolve no
   * máximo 10 e `best_runs` no máximo 8, então contá-los erraria justamente
   * para quem mais joga. Aqui vem a lista inteira, com o nível de cada key.
   *
   * `period` é a semana da Blizzard, não uma data nossa — já vem alinhada ao
   * reset da região, sem fuso e sem ambiguidade de virada.
   */
  async getWeeklyKeys(period: number): Promise<WeeklyKeys[]> {
    const key = process.env.WOW_AUDIT_KEY;
    if (!key) throw new Error('WOW_AUDIT_KEY não configurada. Ver .env.example.');

    const res = await fetch(`${WowAuditService.BASE}/historical_data?period=${period}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) throw new Error(`WoWAudit historical_data HTTP ${res.status}`);

    const body = (await res.json()) as {
      characters: Array<{
        name: string;
        realm: string;
        /** Ausente quando o WoWAudit não tem registro daquela semana. */
        data?: { dungeons_done?: Array<{ level: number }> } | null;
      }>;
    };

    return body.characters.map((c) => {
      // `data` ausente = o WoWAudit não acompanhava o personagem naquela
      // semana. `dungeons_done: []` com `data` presente = fez zero de verdade.
      if (!c.data) {
        return {
          nameKey: toCharacterKey(c.name),
          realmSlug: toSlug(c.realm),
          name: c.name,
          count: null,
          highest: null,
        };
      }

      const feitas = c.data.dungeons_done ?? [];
      const niveis = feitas.map((d) => d.level);

      return {
        nameKey: toCharacterKey(c.name),
        realmSlug: toSlug(c.realm),
        name: c.name,
        count: feitas.length,
        highest: niveis.length > 0 ? Math.max(...niveis) : null,
      };
    });
  }
}
