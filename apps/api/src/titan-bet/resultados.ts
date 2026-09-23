import type { Sessao } from './auditoria';

/**
 * Resultados semanais do Titan Bet (spec §7.3). Domínio puro: as pulls chegam
 * dos reports oficiais já filtradas pelo catálogo de raid (`toRaidPulls`) e
 * com os personagens resolvidos para o id do `Character`.
 *
 * Regras comuns: só vence candidato do snapshot (D-13); empate → todos vencem
 * (R-20); sem vencedor → **proposta** de VOID, que só vale com officer (D-06,
 * D-16). Nada aqui confirma resultado.
 */

/** Dificuldade Mythic no WCL. */
const MYTHIC = 5;

export interface MorteNaPull {
  /** Id do `Character`, ou qualquer id fora do snapshot. */
  characterId: string;
  timestamp: number;
}

export interface PullDaSemana {
  encounterId: string;
  /** A sessão do report em que a pull está (D-26); `null` = fora de terça/quinta. */
  session: Sessao | null;
  difficulty: number;
  kill: boolean;
  startTime: number;
  deaths: MorteNaPull[];
}

export type KillDaSemana =
  { tipo: 'kill'; pull: PullDaSemana } | { tipo: 'sem_kill' } | { tipo: 'revisao'; motivo: string };

export type Resultado<E> =
  | { outcome: 'vencedores'; vencedores: string[]; evidencia: E }
  | { outcome: 'anulado'; voidReason: 'sem_kill' | 'sem_vencedor' | 'sem_pull'; evidencia: E };

/** Pull que conta para o Titan Bet: Mythic, de terça ou quinta. */
function valida(p: PullDaSemana): p is PullDaSemana & { session: Sessao } {
  return p.difficulty === MYTHIC && p.session !== null;
}

/**
 * A kill do boss na semana: terça, ou quinta se não morreu na terça (D-29).
 * Duas kills contrariam o lockout — a auditoria não escolhe, pede revisão
 * (§7.2; o tratamento é a OQ-40).
 */
export function killDaSemana(pulls: PullDaSemana[], encounterId: string): KillDaSemana {
  const kills = pulls.filter((p) => p.encounterId === encounterId && p.kill && valida(p));
  const [kill, ...outras] = kills;
  if (!kill) return { tipo: 'sem_kill' };
  if (outras.length > 0) {
    return { tipo: 'revisao', motivo: `${kills.length} kills do mesmo boss na semana` };
  }
  return { tipo: 'kill', pull: kill };
}

export interface EvidenciaDeMetrica {
  pull: { session: Sessao | null; startTime: number } | null;
  valores: Array<{ characterId: string; valor: number }>;
}

/**
 * Top DPS / HPS / Dispels / Parse % na luta da kill (§7.3). Valor ausente não
 * é zero (Regra 7): quem não tem valor fica fora, não em último.
 */
export function resultadoTopMetrica(
  kill: Extract<KillDaSemana, { tipo: 'kill' | 'sem_kill' }>,
  valores: Array<{ characterId: string; valor: number | null }>,
  candidatos: ReadonlySet<string>,
): Resultado<EvidenciaDeMetrica> {
  if (kill.tipo === 'sem_kill') {
    return { outcome: 'anulado', voidReason: 'sem_kill', evidencia: { pull: null, valores: [] } };
  }

  const medidos = valores.filter(
    (v): v is { characterId: string; valor: number } =>
      candidatos.has(v.characterId) && v.valor !== null,
  );
  const evidencia = {
    pull: { session: kill.pull.session, startTime: kill.pull.startTime },
    valores: medidos,
  };
  if (medidos.length === 0) return { outcome: 'anulado', voidReason: 'sem_vencedor', evidencia };

  const maior = Math.max(...medidos.map((v) => v.valor));
  const vencedores = medidos.filter((v) => v.valor === maior).map((v) => v.characterId);
  return { outcome: 'vencedores', vencedores: ordenados(vencedores), evidencia };
}

/**
 * Os First Death de uma pull: a primeira morte de candidato, pulando quem não
 * está no snapshot (D-13), e todas as de candidato no mesmo timestamp (D-14).
 */
function primeirasMortes(deaths: MorteNaPull[], candidatos: ReadonlySet<string>): string[] {
  const elegiveis = deaths.filter((d) => candidatos.has(d.characterId));
  if (elegiveis.length === 0) return [];
  const primeira = Math.min(...elegiveis.map((d) => d.timestamp));
  return ordenados(elegiveis.filter((d) => d.timestamp === primeira).map((d) => d.characterId));
}

export interface EvidenciaDeFirstDeath {
  pull: { session: Sessao | null; startTime: number } | null;
  primeiraMorte: string[];
}

/** First Death de boss farm: na luta da kill (§7.3). */
export function resultadoFirstDeathFarm(
  kill: Extract<KillDaSemana, { tipo: 'kill' | 'sem_kill' }>,
  candidatos: ReadonlySet<string>,
): Resultado<EvidenciaDeFirstDeath> {
  if (kill.tipo === 'sem_kill') {
    return {
      outcome: 'anulado',
      voidReason: 'sem_kill',
      evidencia: { pull: null, primeiraMorte: [] },
    };
  }
  const primeiraMorte = primeirasMortes(kill.pull.deaths, candidatos);
  const evidencia = {
    pull: { session: kill.pull.session, startTime: kill.pull.startTime },
    primeiraMorte,
  };
  if (primeiraMorte.length === 0) {
    return { outcome: 'anulado', voidReason: 'sem_vencedor', evidencia };
  }
  return { outcome: 'vencedores', vencedores: primeiraMorte, evidencia };
}

export interface EvidenciaDeProgressao {
  /** Cada try, de qual sessão veio e o(s) First Death dela (R-28a). */
  tries: Array<{ session: Sessao; startTime: number; primeiraMorte: string[] }>;
  somas: Record<string, number>;
}

/**
 * First Death de boss em progressão (D-29): todas as pulls Mythic válidas da
 * semana, terça + quinta; por pull, o mesmo percurso do farm; soma por
 * personagem; maior soma vence, empate → vários (R-27).
 */
export function resultadoFirstDeathProgressao(
  pulls: PullDaSemana[],
  encounterId: string,
  candidatos: ReadonlySet<string>,
): Resultado<EvidenciaDeProgressao> {
  const tries = pulls
    .filter((p) => p.encounterId === encounterId)
    .filter(valida)
    .sort((a, b) => a.startTime - b.startTime)
    .map((p) => ({
      session: p.session,
      startTime: p.startTime,
      primeiraMorte: primeirasMortes(p.deaths, candidatos),
    }));

  const somas: Record<string, number> = {};
  for (const t of tries) {
    for (const id of t.primeiraMorte) somas[id] = (somas[id] ?? 0) + 1;
  }
  const evidencia = { tries, somas };

  if (tries.length === 0) return { outcome: 'anulado', voidReason: 'sem_pull', evidencia };
  const valores = Object.values(somas);
  if (valores.length === 0) return { outcome: 'anulado', voidReason: 'sem_vencedor', evidencia };

  const maior = Math.max(...valores);
  const vencedores = Object.keys(somas).filter((id) => somas[id] === maior);
  return { outcome: 'vencedores', vencedores: ordenados(vencedores), evidencia };
}

/**
 * `K` da Weekly Progression: encounters **da Weekly** (marcados e congelados no
 * Ready) mortos em Mythic nos reports oficiais da rodada (D-49). Kill de boss
 * fora desse conjunto não entra e não bloqueia. Só afirmado com **as duas**
 * sessões resolvidas; sessão sem fonte deixa `K` indeterminado, nunca `{}`
 * (D-24, §7.3).
 */
export function killsDaSemana(
  pulls: PullDaSemana[],
  resolvidas: Record<Sessao, boolean>,
  daWeekly: ReadonlySet<string>,
): { tipo: 'K'; encounterIds: string[] } | { tipo: 'indeterminado' } {
  if (!resolvidas.terca || !resolvidas.quinta) return { tipo: 'indeterminado' };
  const mortos = new Set(
    pulls
      .filter((p) => p.kill && valida(p) && daWeekly.has(p.encounterId))
      .map((p) => p.encounterId),
  );
  return { tipo: 'K', encounterIds: ordenados([...mortos]) };
}

/** A aposta da Weekly vence se, e só se, o conjunto é igual a `K` — inclusive `{}` (D-05, D-15). */
export function weeklyVence(aposta: readonly string[], k: readonly string[]): boolean {
  const escolhido = new Set(aposta);
  return escolhido.size === new Set(k).size && k.every((id) => escolhido.has(id));
}

function ordenados(ids: string[]): string[] {
  return [...ids].sort();
}
