import { Injectable } from '@nestjs/common';
import { toSlug } from '@titan/shared';
import { BlizzardService } from '../blizzard/blizzard.service';

interface Match {
  input: string;
  found: boolean;
  character?: string;
  rank?: number;
}

interface RankCount {
  rank: number;
  count: number;
}

export interface RosterProbeResult {
  guild: string;
  realm: string;
  region: string;
  faction: string;
  members: number;
  lastCrawledAt: string | null;
  rankDistribution: RankCount[];
  matches?: Match[];
}

export interface OauthCheckResult {
  ok: true;
  /** true = a Game Data API falhou e isto é o cache anterior — não é uma
   * validação fresca da credencial. */
  stale: boolean;
  members: number;
  rankDistribution: RankCount[];
  matches?: Match[];
}

function contarPorRank(membros: Array<{ rank: number }>): RankCount[] {
  const byRank = new Map<number, number>();
  for (const m of membros) byRank.set(m.rank, (byRank.get(m.rank) ?? 0) + 1);
  return [...byRank.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rank, count]) => ({ rank, count }));
}

/**
 * Lógica que os antigos `scripts/roster-probe.js` e `scripts/oauth-probe.js`
 * faziam soltos, agora dentro da app já rodando — ver TIT-109.
 *
 * O casamento de nome usa `toSlug()`, igual os scripts originais faziam —
 * preservado de propósito, não "corrigido" pra `toCharacterKey()` (Regra 6)
 * nesta migração, porque isso é ferramenta de diagnóstico/relatório, não
 * decisão de acesso: uma colisão aqui no máximo confunde a leitura do
 * resultado, nunca libera ou revoga nada. A produção de verdade
 * (`BlizzardService`) já usa `toCharacterKey()` onde importa.
 */
@Injectable()
export class OpsService {
  constructor(private readonly blizzard: BlizzardService) {}

  /**
   * Roster via Raider.IO (pública, sem auth). Crawleado — pode estar
   * atrasado em relação ao jogo. Fonte da verdade em produção é sempre a
   * Game Data API (ver `checkOauth`); isto é ferramenta de comparação.
   */
  async probeRoster(
    guildName: string,
    realm: string,
    characters: string[],
  ): Promise<RosterProbeResult> {
    const region = 'us';
    const url =
      `https://raider.io/api/v1/guilds/profile` +
      `?region=${region}` +
      `&realm=${encodeURIComponent(toSlug(realm))}` +
      `&name=${encodeURIComponent(guildName)}` +
      `&fields=members`;

    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      throw new Error(`Raider.IO respondeu HTTP ${res.status}`);
    }

    const guild = (await res.json()) as {
      name: string;
      realm: string;
      faction: string;
      last_crawled_at: string | null;
      members?: Array<{ rank: number; character: { name: string } }>;
    };
    const members = guild.members ?? [];

    const index = new Map<string, (typeof members)[number]>();
    for (const m of members) index.set(toSlug(m.character.name), m);

    const matches =
      characters.length > 0
        ? characters.map((nome): Match => {
            const hit = index.get(toSlug(nome));
            return hit
              ? { input: nome, found: true, character: hit.character.name, rank: hit.rank }
              : { input: nome, found: false };
          })
        : undefined;

    return {
      guild: guild.name,
      realm: guild.realm,
      region,
      faction: guild.faction,
      members: members.length,
      lastCrawledAt: guild.last_crawled_at,
      rankDistribution: contarPorRank(members),
      matches,
    };
  }

  /**
   * Valida credencial + config da guilda contra a Game Data API de verdade
   * — reaproveita o caminho que a própria app usa em produção
   * (`BlizzardService.getGuildRosterSnapshot`) em vez de duplicar fetch
   * cru como o script antigo fazia.
   *
   * `force: true` sempre, pra não deixar um cache de leitura recente
   * mascarar uma credencial que ficou ruim agora. Mas se já existir cache
   * de uma chamada anterior bem-sucedida, uma falha ainda degrada pra ele
   * (`stale: true`) em vez de estourar — é o mesmo comportamento que
   * protege o site de derrubar todo mundo por uma falha passageira da
   * Blizzard. Por isso o campo `stale` vai na resposta: sem ele, "ok" com
   * cache velho pareceria uma validação fresca que não foi.
   */
  async checkOauth(characters: string[]): Promise<OauthCheckResult> {
    const snapshot = await this.blizzard.getGuildRosterSnapshot(true);

    const index = new Map<string, (typeof snapshot.members)[number]>();
    for (const m of snapshot.members) index.set(toSlug(m.name), m);

    const matches =
      characters.length > 0
        ? characters.map((nome): Match => {
            const hit = index.get(toSlug(nome));
            return hit
              ? { input: nome, found: true, character: hit.name, rank: hit.rank }
              : { input: nome, found: false };
          })
        : undefined;

    return {
      ok: true,
      stale: snapshot.stale,
      members: snapshot.members.length,
      rankDistribution: contarPorRank(snapshot.members),
      matches,
    };
  }
}
