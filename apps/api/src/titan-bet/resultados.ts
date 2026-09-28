import type { Sessao } from './auditoria';

/**
 * Resultados semanais do Titan Bet (spec §7.3). Domínio puro: as pulls chegam
 * dos reports oficiais já filtradas pelo catálogo de raid (`toRaidPulls`) e
 * com os personagens resolvidos para o id do `Character`.
 *
 * Regras comuns: só vence candidato do snapshot (D-13); empate → todos vencem
 * (R-20); sem vencedor → `sem_vencedor`, com o motivo — o prize pool é
 * redistribuído no settlement (D-61), não restituído. Nada aqui confirma
 * resultado.
 */

/** Dificuldade Mythic no WCL. */
const MYTHIC = 5;

export interface MorteNaPull {
  /** Id do `Character`, ou qualquer id fora do snapshot. */
  characterId: string;
  timestamp: number;
  /** O ator no report, como o WCL chama — só para a evidência (§15.10). */
  ator?: number;
}

export interface PullDaSemana {
  encounterId: string;
  /** A sessão do report em que a pull está (D-26); `null` = fora de terça/quinta. */
  session: Sessao | null;
  difficulty: number;
  kill: boolean;
  startTime: number;
  /** O código do report de onde a pull veio: cópia só existe entre reports (D-63). */
  report: string;
  deaths: MorteNaPull[];
}

export type KillDaSemana = { tipo: 'kill'; pull: PullDaSemana } | { tipo: 'sem_kill' };

/** Por que um mercado ficou sem vencedor premiável (D-61). */
export type MotivoSemVencedor = 'sem_kill' | 'sem_vencedor' | 'sem_pull';

export type Resultado<E> =
  | { outcome: 'vencedores'; vencedores: string[]; evidencia: E }
  | { outcome: 'sem_vencedor'; motivo: MotivoSemVencedor; evidencia: E };

/** Pull que conta para o Titan Bet: Mythic, de terça ou quinta. */
function valida(p: PullDaSemana): p is PullDaSemana & { session: Sessao } {
  return p.difficulty === MYTHIC && p.session !== null;
}

/**
 * A kill do boss na semana: a **primeira**, cronologicamente (D-62) — terça, ou
 * quinta se não morreu na terça (D-29). As outras não produzem resultado.
 */
export function killDaSemana(pulls: PullDaSemana[], encounterId: string): KillDaSemana {
  const [primeira] = pulls
    .filter((p) => p.encounterId === encounterId && p.kill && valida(p))
    .sort((a, b) => a.startTime - b.startTime);
  return primeira ? { tipo: 'kill', pull: primeira } : { tipo: 'sem_kill' };
}

/**
 * Janela em que duas pulls do mesmo boss, vindas de reports diferentes, são a
 * **mesma** try (D-63). **Heurística técnica, não regra de produto:** no M0
 * (§15.8) as cópias diferiram 0,3–3,7 s no início, e pulls diferentes do mesmo
 * boss estiveram a no mínimo 46 s uma da outra. Se um dia isso deixar de valer,
 * muda o número aqui, não a decisão.
 */
export const JANELA_DE_DUPLICATA_MS = 10_000;

/**
 * A timeline consolidada dos `titanbet*` da semana (D-63): cada try uma vez,
 * pela identidade **mesmo encounter + início absoluto** a menos de
 * `JANELA_DE_DUPLICATA_MS` — nunca pela hora do dia —, e só entre **reports
 * diferentes**: dentro de um report cada fight é uma pull, por mais perto que
 * esteja da anterior. Fica a primeira cópia (o início mais cedo); a ordem da
 * saída é a do tempo.
 */
export function consolidarPulls(pulls: PullDaSemana[]): PullDaSemana[] {
  return consolidarComPares(pulls).unicas;
}

/** Uma cópia descartada e a pull que ficou no lugar dela (D-63; evidência, §15.10). */
export interface ParDeDuplicata {
  mantida: PullDaSemana;
  descartada: PullDaSemana;
}

/** `consolidarPulls`, e os pares que ela deduplicou — a prova da deduplicação. */
export function consolidarComPares(pulls: PullDaSemana[]): {
  unicas: PullDaSemana[];
  pares: ParDeDuplicata[];
} {
  const unicas: PullDaSemana[] = [];
  const pares: ParDeDuplicata[] = [];
  for (const p of [...pulls].sort((a, b) => a.startTime - b.startTime)) {
    const original = unicas.find(
      (u) =>
        u.encounterId === p.encounterId &&
        u.report !== p.report &&
        Math.abs(u.startTime - p.startTime) < JANELA_DE_DUPLICATA_MS,
    );
    if (original) pares.push({ mantida: original, descartada: p });
    else unicas.push(p);
  }
  return { unicas, pares };
}

/** Pull que conta para o Titan Bet — a mesma régua dos resultados, para a evidência. */
export function pullValida(p: PullDaSemana): boolean {
  return valida(p);
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
    return { outcome: 'sem_vencedor', motivo: 'sem_kill', evidencia: { pull: null, valores: [] } };
  }

  const medidos = valores.filter(
    (v): v is { characterId: string; valor: number } =>
      candidatos.has(v.characterId) && v.valor !== null,
  );
  const evidencia = {
    pull: { session: kill.pull.session, startTime: kill.pull.startTime },
    valores: medidos,
  };
  if (medidos.length === 0) return { outcome: 'sem_vencedor', motivo: 'sem_vencedor', evidencia };

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
      outcome: 'sem_vencedor',
      motivo: 'sem_kill',
      evidencia: { pull: null, primeiraMorte: [] },
    };
  }
  const primeiraMorte = primeirasMortes(kill.pull.deaths, candidatos);
  const evidencia = {
    pull: { session: kill.pull.session, startTime: kill.pull.startTime },
    primeiraMorte,
  };
  if (primeiraMorte.length === 0) {
    return { outcome: 'sem_vencedor', motivo: 'sem_vencedor', evidencia };
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

  if (tries.length === 0) return { outcome: 'sem_vencedor', motivo: 'sem_pull', evidencia };
  const valores = Object.values(somas);
  if (valores.length === 0) return { outcome: 'sem_vencedor', motivo: 'sem_vencedor', evidencia };

  const maior = Math.max(...valores);
  const vencedores = Object.keys(somas).filter((id) => somas[id] === maior);
  return { outcome: 'vencedores', vencedores: ordenados(vencedores), evidencia };
}

/**
 * Weekly Progression por boss (D-54): as opções são os bosses de progressão
 * congelados no Ready; vencem os que morreram em Mythic, numa sessão oficial,
 * na semana. Vários mortos, vários vencedores (R-20). Nenhum morto → sem
 * vencedor (D-61). Boss farm não é opção — nem entra aqui.
 */
export function resultadoWeekly(
  pulls: PullDaSemana[],
  bossesDeProgressao: readonly string[],
): Resultado<{ opcoes: string[]; mortos: string[] }> {
  const opcoes = new Set(bossesDeProgressao);
  const mortos = ordenados([
    ...new Set(
      pulls
        .filter((p) => p.kill && valida(p) && opcoes.has(p.encounterId))
        .map((p) => p.encounterId),
    ),
  ]);
  const evidencia = { opcoes: [...bossesDeProgressao], mortos };
  if (mortos.length === 0) return { outcome: 'sem_vencedor', motivo: 'sem_kill', evidencia };
  return { outcome: 'vencedores', vencedores: mortos, evidencia };
}

/** O motivo de um `sem_vencedor`, como o cálculo grava na evidência (D-61). */
export function motivoDaEvidencia(evidence: unknown): string | null {
  const motivo = (evidence as { motivo?: unknown } | null)?.motivo;
  return typeof motivo === 'string' ? motivo : null;
}

function ordenados(ids: string[]): string[] {
  return [...ids].sort();
}
