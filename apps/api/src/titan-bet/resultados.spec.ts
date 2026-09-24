import {
  consolidarComPares,
  consolidarPulls,
  killDaSemana,
  resultadoFirstDeathFarm,
  resultadoFirstDeathProgressao,
  resultadoTopMetrica,
  resultadoWeekly,
  type PullDaSemana,
} from './resultados';

/**
 * Resultados semanais — domínio puro, logs fictícios (spec §7.3; D-05, D-06,
 * D-13, D-14, D-15, D-16, D-19, D-23, D-24, D-29; R-20, R-27, R-28a).
 * titan-bet-test-design.md §3.8.
 *
 * Os personagens chegam já resolvidos para o id do `Character`; quem não está
 * no snapshot de candidatos é `outsider`. A métrica (DPS, HPS, dispels, parse)
 * chega como número já lido — qual número é a OQ-25, não este módulo.
 */

const BOSS = 'boss-farm';
const PROG = 'boss-prog';
const CANDIDATOS = new Set(['A', 'B', 'C']);

let relogio = 1_000_000;
const pull = (over: Partial<PullDaSemana> = {}): PullDaSemana => ({
  encounterId: BOSS,
  session: 'terca',
  difficulty: 5,
  kill: false,
  startTime: (relogio += 60_000),
  report: 'R1',
  deaths: [],
  ...over,
});

describe('killDaSemana — a kill do boss farm, de terça ou de quinta', () => {
  it('T-F01: kill só na quinta resolve o mercado pela quinta (D-29, R-22)', () => {
    const quinta = pull({ session: 'quinta', kill: true });
    const r = killDaSemana([pull(), pull(), quinta], BOSS);
    expect(r).toEqual({ tipo: 'kill', pull: quinta });
  });

  it('kill na terça resolve pela terça', () => {
    const terca = pull({ kill: true });
    expect(killDaSemana([pull(), terca], BOSS)).toEqual({ tipo: 'kill', pull: terca });
  });

  it('kill em Heroic não é kill do Titan Bet: só Mythic (difficulty 5)', () => {
    expect(killDaSemana([pull({ kill: true, difficulty: 4 })], BOSS)).toEqual({
      tipo: 'sem_kill',
    });
  });

  it('kill de report fora de terça/quinta não conta (D-19, D-23)', () => {
    expect(killDaSemana([pull({ kill: true, session: null })], BOSS)).toEqual({
      tipo: 'sem_kill',
    });
  });

  it('kill de outro boss não é deste mercado', () => {
    expect(killDaSemana([pull({ kill: true, encounterId: PROG })], BOSS)).toEqual({
      tipo: 'sem_kill',
    });
  });

  // Mudança de produto (D-62): substitui "duas kills → pede revisão".
  it('T-F08: duas kills do mesmo boss → vale a primeira, cronologicamente', () => {
    const quinta = pull({ kill: true, session: 'quinta' });
    const terca = pull({ kill: true, startTime: quinta.startTime - 2 * 24 * 60 * 60 * 1000 });
    expect(killDaSemana([quinta, terca], BOSS)).toEqual({ tipo: 'kill', pull: terca });
  });
});

describe('consolidarPulls — a timeline dos vários reports (D-63)', () => {
  const t0 = 50_000_000;

  it('T-A17: a mesma try em dois reports conta uma vez (mesmo boss, início < 10 s)', () => {
    const r1 = pull({ encounterId: PROG, startTime: t0, report: 'R1' });
    const r2 = pull({ encounterId: PROG, startTime: t0 + 3_700, report: 'R2' });
    expect(consolidarPulls([r1, r2])).toEqual([r1]);
  });

  it('pulls legítimas diferentes do mesmo boss continuam separadas (≥ 46 s no M0)', () => {
    const a = pull({ encounterId: PROG, startTime: t0 });
    const b = pull({ encounterId: PROG, startTime: t0 + 46_000 });
    expect(consolidarPulls([b, a])).toEqual([a, b]);
  });

  // A janela é heurística técnica (M0 §15.8: cópias a 0,3–3,7 s; pulls
  // diferentes a ≥ 46 s), não regra de produto. Cópia só existe entre reports
  // diferentes — dentro de um report, cada fight é uma pull, por mais perto que
  // esteja da anterior.
  it('T-A20: duas pulls do MESMO report, a menos de 10 s, nunca são fundidas', () => {
    const a = pull({ encounterId: PROG, startTime: t0, report: 'R1' });
    const b = pull({ encounterId: PROG, startTime: t0 + 2_000, report: 'R1' });
    expect(consolidarPulls([a, b])).toEqual([a, b]);
  });

  it('T-A20: a borda da janela — 9,999 s entre reports funde; 10 s não', () => {
    const a = pull({ encounterId: PROG, startTime: t0, report: 'R1' });
    const quase = pull({ encounterId: PROG, startTime: t0 + 9_999, report: 'R2' });
    const fora = pull({ encounterId: PROG, startTime: t0 + 10_000, report: 'R2' });
    expect(consolidarPulls([a, quase])).toEqual([a]);
    expect(consolidarPulls([a, fora])).toEqual([a, fora]);
  });

  it('N1: os pares deduplicados — a cópia descartada e a mantida, para a evidência', () => {
    const tryR1 = pull({ encounterId: PROG, startTime: t0, report: 'R1' });
    const tryR2 = pull({ encounterId: PROG, startTime: t0 + 1_000, report: 'R2' });
    const outraR1 = pull({ encounterId: PROG, startTime: t0 + 5_000, report: 'R1' });
    expect(consolidarComPares([tryR2, outraR1, tryR1])).toEqual({
      unicas: [tryR1, outraR1],
      pares: [{ mantida: tryR1, descartada: tryR2 }],
    });
  });

  it('T-A20: uma pull legítima entre duas cópias não some', () => {
    // R1 e R2 gravaram a mesma try; R1 tem outra pull, dele mesmo, 5 s depois.
    const tryR1 = pull({ encounterId: PROG, startTime: t0, report: 'R1' });
    const tryR2 = pull({ encounterId: PROG, startTime: t0 + 1_000, report: 'R2' });
    const outraR1 = pull({ encounterId: PROG, startTime: t0 + 5_000, report: 'R1' });
    expect(consolidarPulls([tryR1, tryR2, outraR1])).toEqual([tryR1, outraR1]);
  });

  it('bosses diferentes no mesmo instante não são duplicata', () => {
    const a = pull({ encounterId: PROG, startTime: t0 });
    const b = pull({ encounterId: BOSS, startTime: t0 + 1_000 });
    expect(consolidarPulls([a, b])).toHaveLength(2);
  });

  it('a identidade é o instante, não a hora do dia: 21:00 de terça ≠ 21:00 de quinta', () => {
    const terca = pull({ encounterId: PROG, startTime: t0 });
    const quinta = pull({
      encounterId: PROG,
      session: 'quinta',
      startTime: t0 + 2 * 24 * 60 * 60 * 1000,
    });
    expect(consolidarPulls([terca, quinta])).toHaveLength(2);
  });

  it('T-A18: kill em dois reports → uma kill; a primeira cópia fica', () => {
    const k1 = pull({ kill: true, startTime: t0 + 500, report: 'R1' });
    const k2 = pull({ kill: true, startTime: t0, report: 'R2' });
    const unicas = consolidarPulls([k1, k2]);
    expect(unicas).toEqual([k2]);
    expect(killDaSemana(unicas, BOSS)).toEqual({ tipo: 'kill', pull: k2 });
  });
});

describe('resultadoTopMetrica — Top DPS / HPS / Dispels / Parse %', () => {
  const kill = { tipo: 'kill' as const, pull: pull({ kill: true }) };

  it('T-F02: só candidato vence — o maior DPS de outsider não conta (D-13)', () => {
    const r = resultadoTopMetrica(
      kill,
      [
        { characterId: 'outsider', valor: 999 },
        { characterId: 'A', valor: 500 },
        { characterId: 'B', valor: 700 },
      ],
      CANDIDATOS,
    );
    expect(r).toMatchObject({ outcome: 'vencedores', vencedores: ['B'] });
  });

  it('candidato ausente da luta não produz métrica e não vence', () => {
    const r = resultadoTopMetrica(kill, [{ characterId: 'A', valor: 10 }], CANDIDATOS);
    expect(r).toMatchObject({ outcome: 'vencedores', vencedores: ['A'] });
  });

  it('T-F03: parse ausente não é zero — o candidato fica fora, não em último', () => {
    const r = resultadoTopMetrica(
      kill,
      [
        { characterId: 'A', valor: null },
        { characterId: 'B', valor: 0 },
      ],
      CANDIDATOS,
    );
    expect(r).toMatchObject({ outcome: 'vencedores', vencedores: ['B'] });
    expect(r.evidencia.valores).toEqual([{ characterId: 'B', valor: 0 }]);
  });

  it('empate → todos vencem (R-20)', () => {
    const r = resultadoTopMetrica(
      kill,
      [
        { characterId: 'A', valor: 800 },
        { characterId: 'B', valor: 800 },
        { characterId: 'C', valor: 100 },
      ],
      CANDIDATOS,
    );
    expect(r).toMatchObject({ outcome: 'vencedores', vencedores: ['A', 'B'] });
  });

  // Mudança de produto (D-61): substitui T-F04 ("sem kill → proposta de VOID").
  it('T-M18: sem kill na semana → sem vencedor, com o motivo — não VOID', () => {
    const r = resultadoTopMetrica({ tipo: 'sem_kill' }, [], CANDIDATOS);
    expect(r).toMatchObject({ outcome: 'sem_vencedor', motivo: 'sem_kill' });
  });

  it('T-M18: kill sem nenhum candidato com valor → sem vencedor, não VOID', () => {
    const r = resultadoTopMetrica(kill, [{ characterId: 'outsider', valor: 1 }], CANDIDATOS);
    expect(r).toMatchObject({ outcome: 'sem_vencedor', motivo: 'sem_vencedor' });
  });

  it('a evidência guarda a pull usada e os valores dos candidatos (§15.10)', () => {
    const r = resultadoTopMetrica(kill, [{ characterId: 'A', valor: 3 }], CANDIDATOS);
    expect(r.evidencia).toEqual({
      pull: { session: 'terca', startTime: kill.pull.startTime },
      valores: [{ characterId: 'A', valor: 3 }],
    });
  });
});

describe('resultadoFirstDeathFarm — na luta da kill (D-13, D-14)', () => {
  it('T-F05: pula outsider; empate na mesma ms conta todos', () => {
    const kill = {
      tipo: 'kill' as const,
      pull: pull({
        kill: true,
        deaths: [
          { characterId: 'outsider', timestamp: 100 },
          { characterId: 'A', timestamp: 200 },
          { characterId: 'B', timestamp: 200 },
          { characterId: 'C', timestamp: 300 },
        ],
      }),
    };
    expect(resultadoFirstDeathFarm(kill, CANDIDATOS)).toMatchObject({
      outcome: 'vencedores',
      vencedores: ['A', 'B'],
    });
  });

  it('a ordem é do timestamp, não da lista que o WCL devolveu', () => {
    const kill = {
      tipo: 'kill' as const,
      pull: pull({
        kill: true,
        deaths: [
          { characterId: 'C', timestamp: 900 },
          { characterId: 'B', timestamp: 400 },
        ],
      }),
    };
    expect(resultadoFirstDeathFarm(kill, CANDIDATOS)).toMatchObject({ vencedores: ['B'] });
  });

  // Mudança de produto (D-61): nenhum dos dois casos é mais proposta de VOID.
  it('T-M18: sem kill ou kill sem morte de candidato → sem vencedor', () => {
    expect(resultadoFirstDeathFarm({ tipo: 'sem_kill' }, CANDIDATOS)).toMatchObject({
      outcome: 'sem_vencedor',
      motivo: 'sem_kill',
    });
    const limpa = { tipo: 'kill' as const, pull: pull({ kill: true }) };
    expect(resultadoFirstDeathFarm(limpa, CANDIDATOS)).toMatchObject({
      outcome: 'sem_vencedor',
      motivo: 'sem_vencedor',
    });
  });
});

describe('resultadoFirstDeathProgressao — todas as tries Mythic da semana (D-29)', () => {
  const morreu = (...ids: string[]) => ids.map((characterId, i) => ({ characterId, timestamp: i }));
  const tryDe = (session: 'terca' | 'quinta', primeiro: string) =>
    pull({ encounterId: PROG, session, deaths: [{ characterId: primeiro, timestamp: 1 }] });

  it('T-P01: soma terça + quinta — terça A 3 / B 2, quinta A 1 / B 3 → B vence com 5', () => {
    const pulls = [
      ...['A', 'A', 'A', 'B', 'B'].map((id) => tryDe('terca', id)),
      ...['A', 'B', 'B', 'B'].map((id) => tryDe('quinta', id)),
    ];
    const r = resultadoFirstDeathProgressao(pulls, PROG, CANDIDATOS);
    expect(r).toMatchObject({ outcome: 'vencedores', vencedores: ['B'] });
    expect(r.evidencia.somas).toEqual({ A: 4, B: 5 });
  });

  it('T-P02: por try, pula outsider; empate exato conta todos — cada um ganha 1', () => {
    const t = pull({
      encounterId: PROG,
      deaths: [
        { characterId: 'outsider', timestamp: 5 },
        { characterId: 'A', timestamp: 9 },
        { characterId: 'B', timestamp: 9 },
      ],
    });
    const r = resultadoFirstDeathProgressao([t], PROG, CANDIDATOS);
    expect(r.evidencia.somas).toEqual({ A: 1, B: 1 });
  });

  it('T-P03: empate na soma → vários vencedores (R-27)', () => {
    const pulls = [...['A', 'A', 'B', 'B'].map((id) => tryDe('terca', id))];
    expect(resultadoFirstDeathProgressao(pulls, PROG, CANDIDATOS)).toMatchObject({
      vencedores: ['A', 'B'],
    });
  });

  it('T-P04: a evidência guarda cada try, a sessão e o(s) First Death (R-28a)', () => {
    const t1 = tryDe('terca', 'A');
    const t2 = pull({ encounterId: PROG, session: 'quinta', deaths: morreu('outsider') });
    const r = resultadoFirstDeathProgressao([t1, t2], PROG, CANDIDATOS);
    expect(r.evidencia.tries).toEqual([
      { session: 'terca', startTime: t1.startTime, primeiraMorte: ['A'] },
      { session: 'quinta', startTime: t2.startTime, primeiraMorte: [] },
    ]);
  });

  it('só Mythic e só terça/quinta entram; a kill também é uma try', () => {
    const pulls = [
      tryDe('terca', 'A'),
      pull({ encounterId: PROG, difficulty: 4, deaths: morreu('B') }),
      pull({ encounterId: PROG, session: null, deaths: morreu('B') }),
      pull({ encounterId: PROG, session: 'quinta', kill: true, deaths: morreu('C') }),
    ];
    const r = resultadoFirstDeathProgressao(pulls, PROG, CANDIDATOS);
    expect(r.evidencia.somas).toEqual({ A: 1, C: 1 });
  });

  // Mudança de produto (D-61): substitui T-P05 ("sem pull → proposta de VOID").
  it('T-M18: nenhuma pull válida na semana → sem vencedor', () => {
    expect(resultadoFirstDeathProgressao([pull()], PROG, CANDIDATOS)).toMatchObject({
      outcome: 'sem_vencedor',
      motivo: 'sem_pull',
    });
  });

  it('pulls sem nenhuma morte de candidato → sem vencedor', () => {
    const r = resultadoFirstDeathProgressao(
      [pull({ encounterId: PROG, deaths: morreu('outsider') })],
      PROG,
      CANDIDATOS,
    );
    expect(r).toMatchObject({ outcome: 'sem_vencedor', motivo: 'sem_vencedor' });
  });
});

/**
 * Weekly Progression por boss (D-54) — **mudança de produto**: substitui a Weekly
 * por conjunto exato e `K` (T-W01–T-W05). Cada boss de progressão é uma opção;
 * as vencedoras são os bosses mortos na semana.
 */
describe('resultadoWeekly — os bosses de progressão mortos na semana (D-54)', () => {
  const PROGRESSAO = ['P1', 'P2', 'P3'];

  it('T-W12: boss de progressão morto em Mythic, terça ou quinta, é opção vencedora', () => {
    const r = resultadoWeekly(
      [
        pull({ encounterId: 'P1', kill: true }),
        pull({ encounterId: 'P2', session: 'quinta', kill: true }),
        pull({ encounterId: 'P3' }),
      ],
      PROGRESSAO,
    );
    expect(r).toMatchObject({ outcome: 'vencedores', vencedores: ['P1', 'P2'] });
  });

  it('T-W10: boss farm morto não é opção nem vencedor', () => {
    const r = resultadoWeekly(
      [pull({ encounterId: BOSS, kill: true }), pull({ encounterId: 'P1', kill: true })],
      PROGRESSAO,
    );
    expect(r).toMatchObject({ vencedores: ['P1'] });
  });

  it('T-W12: kill em Heroic ou fora de terça/quinta não conta', () => {
    const r = resultadoWeekly(
      [
        pull({ encounterId: 'P1', kill: true, difficulty: 4 }),
        pull({ encounterId: 'P2', kill: true, session: null }),
      ],
      PROGRESSAO,
    );
    expect(r).toMatchObject({ outcome: 'sem_vencedor', motivo: 'sem_kill' });
  });

  it('T-W13: nenhum boss de progressão morto → sem vencedor (D-61)', () => {
    const r = resultadoWeekly([pull({ encounterId: 'P1' })], PROGRESSAO);
    expect(r).toMatchObject({ outcome: 'sem_vencedor', motivo: 'sem_kill' });
    expect(r.evidencia).toEqual({ opcoes: PROGRESSAO, mortos: [] });
  });

  it('a evidência lista as opções e os mortos', () => {
    const r = resultadoWeekly([pull({ encounterId: 'P3', kill: true })], PROGRESSAO);
    expect(r.evidencia).toEqual({ opcoes: PROGRESSAO, mortos: ['P3'] });
  });
});
