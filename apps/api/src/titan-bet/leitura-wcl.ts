import type { BetCandidateRole, BetMarketKind } from '@prisma/client';
import { toCharacterKey, toRealmMatchKey } from '@titan/shared';
import type { Sessao } from './auditoria';
import type { PullDaSemana } from './resultados';

/**
 * Do report oficial do WCL para o domínio de resultados (D-43, D-47; §7.3,
 * §15.10). Puro: recebe o que a API v2 devolveu e devolve pulls e valores.
 *
 * A régua é a da D-47: **o valor que a tabela do WCL exibe**. Validado no
 * gate #1 (§15.0) — DPS e HPS são `total ÷ duração da luta`, cura com absorb e
 * pets, e Parse % é o `rankPercent` de `compare: Rankings, timeframe: Today`.
 */

/** A variante de ranking que reproduz a coluna "Parse %" da tela (gate #1). */
export const VARIANTE_DO_PARSE = { compare: 'Rankings', timeframe: 'Today' } as const;

export interface CandidatoIdentificavel {
  characterId: string;
  /** Como o snapshot do Ready gravou. */
  name: string;
  realm: string;
  role: BetCandidateRole;
}

export interface LinhaDeTabela {
  /** Id do ator no report. */
  id: number;
  name: string;
  total: number;
}

export interface LinhaDeRanking {
  name: string;
  server: { name: string };
  spec: string;
  amount: number;
  rankPercent: number;
  bracketPercent: number;
}

/** `table(dataType: Dispels)`: grupos → debuffs removidos → quem removeu. */
export interface TabelaDeDispels {
  entries: Array<{
    name?: string;
    entries?: Array<{
      name?: string;
      details?: Array<{ id: number; name: string; total: number }>;
    }>;
  }>;
}

export interface LeituraDaKill {
  damage: LinhaDeTabela[];
  healing: LinhaDeTabela[];
  dispels: TabelaDeDispels;
  rankingsDps: LinhaDeRanking[];
  rankingsHps: LinhaDeRanking[];
}

export interface FightDoReport {
  id: number;
  encounterID: number;
  difficulty: number | null;
  kill: boolean | null;
  /** Offset dentro do report, em ms. */
  startTime: number;
  endTime: number;
}

export interface LeituraDoReport {
  code: string;
  /** Epoch ms do início do report. */
  startTime: number;
  fights: FightDoReport[];
  actors: Array<{ id: number; name: string; server: string }>;
  /** `events(dataType: Deaths)`; `timestamp` é offset dentro do report. */
  deaths: Array<{ fight: number; targetID: number; timestamp: number }>;
  /** As tabelas e rankings das kills, por fight id. */
  kills: Record<number, LeituraDaKill>;
}

/**
 * O candidato que é este ator, ou `null`. Nome por `toCharacterKey` (mantém o
 * acento — `Shrëwd` e `Shrewd` são pessoas diferentes) e realm por
 * `toRealmMatchKey` (o WCL escreve `Area52`, o snapshot `Area 52`). Regra 6.
 */
export function identificarAtor(
  ator: { name: string; server: string },
  candidatos: readonly CandidatoIdentificavel[],
): string | null {
  const nome = toCharacterKey(ator.name);
  const realm = toRealmMatchKey(ator.server);
  const achado = candidatos.find(
    (c) => toCharacterKey(c.name) === nome && toRealmMatchKey(c.realm) === realm,
  );
  return achado?.characterId ?? null;
}

/**
 * As pulls dos encounters da rodada neste report, na sessão **do report** (D-26).
 * Morte de quem não é candidato fica na lista como `fora:<ator>` — o domínio
 * pula, mas a evidência mostra quem morreu antes (D-13, R-28a).
 *
 * `encounters`: id do encounter no WCL → id do `BetRoundEncounter`.
 */
export function pullsDoReport(
  report: LeituraDoReport,
  sessao: Sessao,
  encounters: ReadonlyMap<number, string>,
  candidatos: readonly CandidatoIdentificavel[],
): PullDaSemana[] {
  const quem = idsDosAtores(report, candidatos);
  return report.fights
    .filter((f) => encounters.has(f.encounterID))
    .map((f) => ({
      encounterId: encounters.get(f.encounterID)!,
      session: sessao,
      difficulty: f.difficulty ?? 0,
      kill: f.kill === true,
      startTime: report.startTime + f.startTime,
      deaths: report.deaths
        .filter((d) => d.fight === f.id)
        .map((d) => ({
          characterId: quem.get(d.targetID) ?? `fora:${d.targetID}`,
          timestamp: report.startTime + d.timestamp,
        })),
    }));
}

export interface ValorDaKill {
  characterId: string;
  valor: number;
  /** O que foi lido, como veio — a evidência da §15.10. */
  evidencia: Record<string, string | number>;
}

type MercadoDeMetrica = Extract<
  BetMarketKind,
  'top_dps' | 'top_dps_parse' | 'top_hps' | 'top_hps_parse' | 'top_dispels'
>;

/**
 * O valor de cada candidato na luta da kill, para o mercado. Quem não é
 * candidato não entra; candidato sem linha não produz valor — ausente não é
 * zero (Regra 7, T-F03).
 */
export function valoresDaKill(
  mercado: MercadoDeMetrica,
  kill: { fight: FightDoReport; leitura: LeituraDaKill },
  report: LeituraDoReport,
  candidatos: readonly CandidatoIdentificavel[],
): ValorDaKill[] {
  const duracaoS = (kill.fight.endTime - kill.fight.startTime) / 1000;
  const ator = new Map(report.actors.map((a) => [a.id, a]));
  const daTabela = (linhas: LinhaDeTabela[]) =>
    linhas.flatMap((l) => {
      const a = ator.get(l.id);
      const characterId = a ? identificarAtor(a, candidatos) : null;
      if (!characterId) return [];
      return [
        {
          characterId,
          valor: l.total / duracaoS,
          evidencia: { name: a!.name, server: a!.server, total: l.total },
        },
      ];
    });
  const doRanking = (linhas: LinhaDeRanking[], metric: 'dps' | 'hps') =>
    linhas.flatMap((l) => {
      const characterId = identificarAtor({ name: l.name, server: l.server.name }, candidatos);
      if (!characterId) return [];
      return [
        {
          characterId,
          valor: l.rankPercent,
          evidencia: {
            name: l.name,
            server: l.server.name,
            spec: l.spec,
            metric,
            ...VARIANTE_DO_PARSE,
            rankPercent: l.rankPercent,
            bracketPercent: l.bracketPercent,
          },
        },
      ];
    });

  switch (mercado) {
    case 'top_dps':
      return daTabela(kill.leitura.damage);
    case 'top_hps':
      return daTabela(kill.leitura.healing);
    case 'top_dps_parse':
      return doRanking(kill.leitura.rankingsDps, 'dps');
    case 'top_hps_parse':
      return doRanking(kill.leitura.rankingsHps, 'hps');
    case 'top_dispels':
      return [...dispelsPorAtor(kill.leitura.dispels)].flatMap(([id, d]) => {
        const a = ator.get(id) ?? { name: d.name, server: '' };
        const characterId = identificarAtor(a, candidatos);
        if (!characterId) return [];
        return [
          {
            characterId,
            valor: d.total,
            evidencia: { name: a.name, server: a.server, total: d.total },
          },
        ];
      });
  }
}

/** Dispels por ator: a tabela agrupa por debuff removido; soma-se o de cada um. */
export function dispelsPorAtor(
  tabela: TabelaDeDispels,
): Map<number, { name: string; total: number }> {
  const porAtor = new Map<number, { name: string; total: number }>();
  for (const grupo of tabela.entries) {
    for (const debuff of grupo.entries ?? []) {
      for (const d of debuff.details ?? []) {
        const atual = porAtor.get(d.id);
        porAtor.set(d.id, { name: d.name, total: (atual?.total ?? 0) + d.total });
      }
    }
  }
  return porAtor;
}

function idsDosAtores(
  report: LeituraDoReport,
  candidatos: readonly CandidatoIdentificavel[],
): Map<number, string> {
  const ids = new Map<number, string>();
  for (const a of report.actors) {
    const characterId = identificarAtor(a, candidatos);
    if (characterId) ids.set(a.id, characterId);
  }
  return ids;
}
