import { randomUUID } from 'node:crypto';
import { resultadosDaAuditoriaSchema } from '@titan/shared';
import type { BetCandidateRole, BetMarketKind } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { AuditoriaRecusada } from '../../../src/titan-bet/auditoria.service';
import { CalculoService, type ReportsParaCalculo } from '../../../src/titan-bet/calculo.service';
import type { LeituraDaKill, LeituraDoReport } from '../../../src/titan-bet/leitura-wcl';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import { esperarPassar, depoisDaQuinta } from './ciclo';
import { Fabrica } from './fabrica';

/**
 * O cálculo do Auditar (D-29, D-43, D-44, D-47; §7.3, §15.10): da auditoria
 * `pronta` aos resultados gravados, com a auditoria `calculada`.
 * titan-bet-test-design.md §3.16, T-Q01–T-Q10.
 *
 * Banco real, ciclo de vida real (preparação → Ready → apostas válidas →
 * cutoff → Auditar); só o WCL é falso — os reports chegam no formato da API.
 */
jest.setTimeout(60_000);

const OFFICER = { userId: 'officer-teste', battletag: 'Officer#0001' };
const FARM = 880001;
const PROG = 880002;
const FORA = 880003; // boss que não está na rodada
const SEM_WEEKLY = 880004; // boss farm da rodada: fora da Weekly (D-54)
const PROG2 = 880005; // segundo boss de progressão, que não morre
/** Os reports começam em noites diferentes, como numa semana real. */
const TERCA_21H = 1_000_000;
const QUINTA_21H = TERCA_21H + 2 * 24 * 60 * 60 * 1000;

describe('Titan Bet — cálculo do Auditar (serviço + banco)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let repo: TitanBetRepository;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    repo = new TitanBetRepository(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  type Pessoa = { characterId: string; name: string; role: BetCandidateRole; actor: number };

  /**
   * Rodada com Top DPS, Top DPS Parse e First Death no boss farm, First Death no
   * de progressão e a Weekly com os dois; três candidatos; apostas válidas.
   */
  async function cenario() {
    const rodada = await f.rodada({ cutoffAt: new Date(Date.now() + 4_000) });
    const farm = await f.encounter(rodada.id, {
      encounterId: FARM,
      track: 'farm',
    });
    const prog = await f.encounter(rodada.id, {
      encounterId: PROG,
      track: 'progressao',
    });
    const prog2 = await f.encounter(rodada.id, { encounterId: PROG2, track: 'progressao' });
    const semWeekly = await f.encounter(rodada.id, {
      encounterId: SEM_WEEKLY,
      track: 'farm',
    });
    const m: Record<string, { id: string; kind: BetMarketKind }> = {
      topDps: await f.mercadoDeBoss(farm, 'top_dps'),
      parse: await f.mercadoDeBoss(farm, 'top_dps_parse'),
      fdFarm: await f.mercadoDeBoss(farm, 'first_death'),
      fdProg: await f.mercadoDeBoss(prog, 'first_death'),
      weekly: await f.mercadoWeekly(rodada.id),
    };

    const pessoas: Record<'A' | 'B' | 'H', Pessoa> = {} as never;
    for (const [chave, role, actor] of [
      ['A', 'Melee', 10],
      ['B', 'Ranged', 11],
      ['H', 'Heal', 12],
    ] as const) {
      const pj = await f.personagem();
      const name = `N${randomUUID().slice(0, 8)}`;
      await db.betRoundCandidate.create({
        data: { roundId: rodada.id, characterId: pj.id, role, name, realm: 'Azralon' },
      });
      pessoas[chave] = { characterId: pj.id, name, role, actor };
    }
    const apostador = await f.personagem();
    await f.bettor(rodada.id, apostador.id);
    await f.pronta(rodada.id);

    /** Um slip válido com uma aposta. */
    async function apostar(
      marketId: string,
      kind: BetMarketKind,
      stake: number,
      alvo: Pessoa | null,
      boss: string | null = null,
    ) {
      const slip = await f.slip(rodada.id, apostador.id, 'rascunho', {
        ownerUserId: `conta-${randomUUID()}`,
      });
      const bet = await db.bet.create({
        data: {
          slipId: slip.id,
          roundId: rodada.id,
          marketId,
          marketKind: kind,
          stake,
          targetCharacterId: alvo?.characterId ?? null,
          targetRole: alvo?.role ?? null,
          // A Weekly aposta num boss de progressão (D-54).
          targetEncounterId: boss,
          targetEncounterTrack: boss ? 'progressao' : null,
        },
      });
      await db.betSlip.update({
        where: { id: slip.id },
        data: {
          status: 'aguardando_deposito',
          submittedAt: new Date(),
          expectedTotal: stake,
          depositCharacterId: apostador.id,
        },
      });
      await db.betSlip.update({
        where: { id: slip.id },
        data: {
          status: 'valido',
          validatedAt: new Date(),
          validatedByUserId: OFFICER.userId,
          validatedByBattletag: OFFICER.battletag,
        },
      });
      return bet;
    }

    return { rodada, farm, prog, prog2, semWeekly, m, pessoas, apostar };
  }

  type Cenario = Awaited<ReturnType<typeof cenario>>;

  /** Depois do cutoff: a auditoria `pronta` com as duas fontes congeladas. */
  /** Os `titanbet*` de cada sessão, congelados na fonte (D-63). */
  async function auditoriaPronta(
    c: Cenario,
    reports: Record<'terca' | 'quinta', string[]> = { terca: ['Terca1'], quinta: ['Quinta1'] },
  ) {
    await esperarPassar(db, c.rodada.cutoffAt);
    const auditoria = await db.betAudit.create({
      data: {
        roundId: c.rodada.id,
        attempt: 1,
        status: 'pronta',
        startedByUserId: OFFICER.userId,
        startedByBattletag: OFFICER.battletag,
      },
    });
    for (const session of ['terca', 'quinta'] as const) {
      const fonte = await db.betAuditSource.create({
        data: { auditId: auditoria.id, session, resolution: 'automatica' },
      });
      for (const code of reports[session]) {
        await db.betAuditSourceReport.create({
          data: {
            sourceId: fonte.id,
            reportCode: code,
            reportTitle: 'titanbet',
            reportRevision: 3,
            reportStartTime: new Date(),
          },
        });
      }
    }
    return auditoria;
  }

  const semKill = (): LeituraDaKill => ({
    damage: [],
    healing: [],
    dispels: { entries: [] },
    rankingsDps: [],
    rankingsHps: [],
  });

  /** Um report falso: atores A, B, H e um outsider (99). */
  function report(
    c: Cenario,
    code: string,
    fights: LeituraDoReport['fights'],
    deaths: LeituraDoReport['deaths'],
    kills: LeituraDoReport['kills'] = {},
    startTime = TERCA_21H,
  ): LeituraDoReport {
    return {
      code,
      startTime,
      fights,
      actors: [
        ...Object.values(c.pessoas).map((p) => ({ id: p.actor, name: p.name, server: 'Azralon' })),
        { id: 99, name: 'Outsider', server: 'Azralon' },
      ],
      deaths,
      kills,
    };
  }

  const leituraDaKillFarm = (c: Cenario, parseA = 95): LeituraDaKill => ({
    ...semKill(),
    damage: [
      { id: 10, name: c.pessoas.A.name, total: 30_000_000 },
      { id: 11, name: c.pessoas.B.name, total: 24_000_000 },
      { id: 99, name: 'Outsider', total: 90_000_000 },
    ],
    rankingsDps: [
      {
        name: c.pessoas.A.name,
        server: { name: 'Azralon' },
        spec: 'Fury',
        amount: 1,
        rankPercent: parseA,
        bracketPercent: 10,
      },
      {
        name: c.pessoas.B.name,
        server: { name: 'Azralon' },
        spec: 'Fire',
        amount: 1,
        rankPercent: 80,
        bracketPercent: 99,
      },
    ],
  });

  /** WCL falso: por código de report. */
  function wcl(reports: Record<string, LeituraDoReport>) {
    const lidos: string[] = [];
    const porta: ReportsParaCalculo = {
      getTitanBetReport: (code: string) => {
        lidos.push(code);
        return Promise.resolve(reports[code]!);
      },
    };
    return { porta, lidos };
  }

  /**
   * Semana padrão: terça com 2 tries do prog (B morre primeiro nas duas) e a kill
   * do farm; quinta com 1 try do prog (A primeiro) e a kill do prog.
   */
  function semanaPadrao(c: Cenario, parseA = 95) {
    const terca = report(
      c,
      'Terca1',
      [
        { id: 1, encounterID: PROG, difficulty: 5, kill: false, startTime: 0, endTime: 60_000 },
        {
          id: 2,
          encounterID: PROG,
          difficulty: 5,
          kill: false,
          startTime: 70_000,
          endTime: 130_000,
        },
        {
          id: 3,
          encounterID: FARM,
          difficulty: 5,
          kill: true,
          startTime: 200_000,
          endTime: 500_000,
        },
      ],
      [
        { fight: 1, targetID: 99, timestamp: 10_000 },
        { fight: 1, targetID: 11, timestamp: 11_000 },
        { fight: 2, targetID: 11, timestamp: 80_000 },
        { fight: 3, targetID: 12, timestamp: 250_000 },
        { fight: 3, targetID: 10, timestamp: 260_000 },
      ],
      { 3: leituraDaKillFarm(c, parseA) },
    );
    const quinta = report(
      c,
      'Quinta1',
      [
        { id: 1, encounterID: PROG, difficulty: 5, kill: false, startTime: 0, endTime: 60_000 },
        {
          id: 2,
          encounterID: PROG,
          difficulty: 5,
          kill: true,
          startTime: 70_000,
          endTime: 300_000,
        },
      ],
      [
        { fight: 1, targetID: 10, timestamp: 5_000 },
        { fight: 2, targetID: 11, timestamp: 90_000 },
      ],
      { 2: semKill() },
      QUINTA_21H,
    );
    return { Terca1: terca, Quinta1: quinta };
  }

  const resultadosDe = (auditId: string) =>
    db.betMarketResult.findMany({
      where: { auditId },
      include: { winners: true, kills: true },
    });

  describe('T-Q01 — calcula todos os mercados e marca a auditoria calculada', () => {
    it('um resultado por mercado; V/P/W das apostas válidas; vencedores do snapshot', async () => {
      const c = await cenario();
      await c.apostar(c.m.topDps!.id, 'top_dps', 600, c.pessoas.A);
      await c.apostar(c.m.topDps!.id, 'top_dps', 400, c.pessoas.B);
      const a = await auditoriaPronta(c);

      await new CalculoService(repo, wcl(semanaPadrao(c)).porta, depoisDaQuinta).calcular(a.id);

      const auditoria = await db.betAudit.findUniqueOrThrow({ where: { id: a.id } });
      expect(auditoria.status).toBe('calculada');
      expect(auditoria.calculatedAt).toBeInstanceOf(Date);
      const rs = await resultadosDe(a.id);
      expect(rs).toHaveLength(5);

      // Top DPS: A 100k (30M / 300 s) > B 80k; o outsider com 90M não conta (D-13).
      const top = rs.find((r) => r.marketId === c.m.topDps!.id)!;
      expect(top).toMatchObject({
        outcome: 'vencedores',
        validPool: 1000,
        prizePool: 900,
        winningStake: 600,
        // titanbet-2: Weekly por boss (D-54) e sem vencedor (D-61) — mudança de produto.
        algorithmVersion: 'titanbet-2',
      });
      expect(top.winners.map((w) => w.characterId)).toEqual([c.pessoas.A.characterId]);
    });
  });

  describe('T-K04 — a role do Ready decide o mercado, não a spec jogada (D-51; guarda de regressão)', () => {
    it('candidato Heal com o maior dano da luta fica fora do Top DPS', async () => {
      const c = await cenario();
      await c.apostar(c.m.topDps!.id, 'top_dps', 500, c.pessoas.A);
      const a = await auditoriaPronta(c);
      const semana = semanaPadrao(c);
      // H, Heal no snapshot, jogou de DPS e fez o maior dano da luta.
      semana.Terca1.kills[3]!.damage.push({ id: 12, name: c.pessoas.H.name, total: 80_000_000 });
      await new CalculoService(repo, wcl(semana).porta, depoisDaQuinta).calcular(a.id);

      const top = (await resultadosDe(a.id)).find((r) => r.marketId === c.m.topDps!.id)!;
      expect(top.winners.map((w) => w.characterId)).toEqual([c.pessoas.A.characterId]);
      const ev = top.evidence as { valores: Array<{ characterId: string }> };
      expect(ev.valores.map((v) => v.characterId)).not.toContain(c.pessoas.H.characterId);
    });
  });

  describe('T-Q02 — First Death de farm e de progressão (D-13, D-14, D-29)', () => {
    it('farm: na kill, H morre primeiro; progressão: B 2 (terça) × A 1 (quinta) → B', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      await new CalculoService(repo, wcl(semanaPadrao(c)).porta, depoisDaQuinta).calcular(a.id);
      const rs = await resultadosDe(a.id);

      const farm = rs.find((r) => r.marketId === c.m.fdFarm!.id)!;
      expect(farm.winners.map((w) => w.characterId)).toEqual([c.pessoas.H.characterId]);

      const prog = rs.find((r) => r.marketId === c.m.fdProg!.id)!;
      expect(prog.winners.map((w) => w.characterId)).toEqual([c.pessoas.B.characterId]);
      // A kill da quinta também é try (B morre primeiro nela): B 3, A 1.
      const ev = prog.evidence as { resultado: { somas: Record<string, number> } };
      expect(ev.resultado.somas).toEqual({
        [c.pessoas.A.characterId]: 1,
        [c.pessoas.B.characterId]: 3,
      });
    });
  });

  // Mudança de produto (D-54): substitui T-Q03 (K gravado, W pelo conjunto
  // exato). A Weekly vence por boss: os de progressão mortos são as opções
  // vencedoras.
  describe('T-W17 — Weekly por boss: bosses de progressão mortos vencem (D-54)', () => {
    it('o boss morto na quinta vence; o que não morreu perde; farm não é opção', async () => {
      const c = await cenario();
      await c.apostar(c.m.weekly!.id, 'weekly_progression', 500, null, c.prog.id);
      await c.apostar(c.m.weekly!.id, 'weekly_progression', 300, null, c.prog2.id);
      const a = await auditoriaPronta(c);
      await new CalculoService(repo, wcl(semanaPadrao(c)).porta, depoisDaQuinta).calcular(a.id);

      const w = (await resultadosDe(a.id)).find((r) => r.marketId === c.m.weekly!.id)!;
      expect(w).toMatchObject({ outcome: 'vencedores', validPool: 800, winningStake: 500 });
      // O farm morreu na terça e não é opção; só o boss de progressão morto vence.
      expect(w.kills.map((k) => k.roundEncounterId)).toEqual([c.prog.id]);
      expect(w.winners).toHaveLength(0);
    });

    it('T-W13: nenhum boss de progressão morto → Weekly sem vencedor (D-61)', async () => {
      const c = await cenario();
      await c.apostar(c.m.weekly!.id, 'weekly_progression', 500, null, c.prog.id);
      const a = await auditoriaPronta(c);
      const semana = semanaPadrao(c);
      semana.Quinta1.fights = semana.Quinta1.fights.map((x) => ({ ...x, kill: false }));
      await new CalculoService(repo, wcl(semana).porta, depoisDaQuinta).calcular(a.id);

      const w = (await resultadosDe(a.id)).find((r) => r.marketId === c.m.weekly!.id)!;
      expect(w).toMatchObject({
        outcome: 'sem_vencedor',
        validPool: 500,
        prizePool: 450,
        winningStake: 0,
        voidReason: null,
      });
      expect((w.evidence as { motivo: string }).motivo).toBe('sem_kill');
    });
  });

  describe('T-Q04 — Parse % congelado na evidência (D-43, T-F06)', () => {
    it('grava rankPercent e a variante; o WCL mudar depois não muda o resultado', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      const semana = semanaPadrao(c, 95);
      await new CalculoService(repo, wcl(semana).porta, depoisDaQuinta).calcular(a.id);

      const antes = (await resultadosDe(a.id)).find((r) => r.marketId === c.m.parse!.id)!;
      expect(antes.winners.map((w) => w.characterId)).toEqual([c.pessoas.A.characterId]);
      const ev = antes.evidence as { valores: Array<{ evidencia: Record<string, unknown> }> };
      expect(ev.valores[0]!.evidencia).toMatchObject({
        rankPercent: 95,
        compare: 'Rankings',
        timeframe: 'Today',
        metric: 'dps',
      });

      // O parse "de hoje" mudou: calcular de novo não é permitido — é outra tentativa.
      const depois = wcl(semanaPadrao(c, 40)).porta;
      await expect(
        new CalculoService(repo, depois, depoisDaQuinta).calcular(a.id),
      ).rejects.toBeInstanceOf(AuditoriaRecusada);
      const agora = (await resultadosDe(a.id)).find((r) => r.marketId === c.m.parse!.id)!;
      expect(agora.evidence).toEqual(antes.evidence);
    });
  });

  describe('T-Q05 — sem vencedor e W = 0 ficam como resultado, não como decisão', () => {
    // Mudança de produto (D-61): substitui "sem kill → `anulado` com motivo". O
    // boss que não morreu não é VOID: o mercado fica sem vencedor e o P é
    // redistribuído no settlement.
    it('T-M18: sem kill do farm na semana → mercados do farm `sem_vencedor`', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      const semana = semanaPadrao(c);
      semana.Terca1.fights = semana.Terca1.fights.filter((x) => x.encounterID !== FARM);
      await new CalculoService(repo, wcl(semana).porta, depoisDaQuinta).calcular(a.id);

      const top = (await resultadosDe(a.id)).find((r) => r.marketId === c.m.topDps!.id)!;
      expect(top).toMatchObject({
        outcome: 'sem_vencedor',
        voidReason: null,
        winningStake: 0,
      });
      expect((top.evidence as { motivo: string }).motivo).toBe('sem_kill');
      const anulados = (await resultadosDe(a.id)).filter((r) => r.outcome === 'anulado');
      expect(anulados).toHaveLength(0);
    });

    it('ninguém apostou no vencedor → `vencedores` com W = 0 (a D-44 é no settlement)', async () => {
      const c = await cenario();
      await c.apostar(c.m.topDps!.id, 'top_dps', 700, c.pessoas.B);
      const a = await auditoriaPronta(c);
      await new CalculoService(repo, wcl(semanaPadrao(c)).porta, depoisDaQuinta).calcular(a.id);

      const top = (await resultadosDe(a.id)).find((r) => r.marketId === c.m.topDps!.id)!;
      expect(top).toMatchObject({
        outcome: 'vencedores',
        validPool: 700,
        prizePool: 630,
        winningStake: 0,
      });
    });
  });

  describe('T-Q06 — o que o cálculo recusa, sem gravar nada', () => {
    it('auditoria que não está pronta', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      await db.betAudit.update({ where: { id: a.id }, data: { status: 'aguardando_revisao' } });
      await expect(
        new CalculoService(repo, wcl(semanaPadrao(c)).porta, depoisDaQuinta).calcular(a.id),
      ).rejects.toBeInstanceOf(AuditoriaRecusada);
      expect(await db.betMarketResult.count({ where: { auditId: a.id } })).toBe(0);
    });

    // Mudança de produto (D-62): substitui "duas kills do mesmo boss → revisão".
    it('T-F08: duas kills do mesmo boss → vale a primeira; o cálculo segue', async () => {
      const c = await cenario();
      await c.apostar(c.m.topDps!.id, 'top_dps', 500, c.pessoas.A);
      const a = await auditoriaPronta(c);
      const semana = semanaPadrao(c);
      // Uma segunda kill do farm na quinta, em que B teria o maior dano.
      semana.Quinta1.fights.push({
        id: 9,
        encounterID: FARM,
        difficulty: 5,
        kill: true,
        startTime: 400_000,
        endTime: 700_000,
      });
      semana.Quinta1.kills[9] = {
        ...semKill(),
        damage: [{ id: 11, name: c.pessoas.B.name, total: 99_000_000 }],
      };
      await new CalculoService(repo, wcl(semana).porta, depoisDaQuinta).calcular(a.id);

      const top = (await resultadosDe(a.id)).find((r) => r.marketId === c.m.topDps!.id)!;
      expect(top.winners.map((w) => w.characterId)).toEqual([c.pessoas.A.characterId]);
    });

    // Mudança de produto (D-54): o T-W05 da D-49 (K ∩ Weekly) perdeu o objeto.
    // O que continua valendo: kill de boss fora da rodada ou farm não bloqueia e
    // não vira opção da Weekly (T-W10).
    it('T-W10 — kill de boss farm ou fora da rodada não bloqueia nem vence a Weekly', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      const semana = semanaPadrao(c);
      for (const [id, encounterID] of [
        [8, FORA],
        [9, SEM_WEEKLY],
      ] as const) {
        semana.Quinta1.fights.push({
          id,
          encounterID,
          difficulty: 5,
          kill: true,
          startTime: 400_000 + id * 1000,
          endTime: 600_000 + id * 1000,
        });
        semana.Quinta1.kills[id] = semKill();
      }
      await new CalculoService(repo, wcl(semana).porta, depoisDaQuinta).calcular(a.id);

      const w = (await resultadosDe(a.id)).find((r) => r.marketId === c.m.weekly!.id)!;
      expect(w.kills.map((k) => k.roundEncounterId)).toEqual([c.prog.id]);
    });

    it('T-A17/T-A18: dois reports da terça com as mesmas pulls contam uma vez', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c, { terca: ['Terca1', 'Terca2'], quinta: ['Quinta1'] });
      const semana = semanaPadrao(c);
      // O segundo logger começou 2 s depois: as mesmas fights, deslocadas.
      const copia = {
        ...semana.Terca1,
        code: 'Terca2',
        startTime: semana.Terca1.startTime + 2_000,
      };
      await new CalculoService(
        repo,
        wcl({ ...semana, Terca2: copia }).porta,
        depoisDaQuinta,
      ).calcular(a.id);

      const prog = (await resultadosDe(a.id)).find((r) => r.marketId === c.m.fdProg!.id)!;
      const ev = prog.evidence as { resultado: { somas: Record<string, number> } };
      // As mesmas somas do report único (T-Q02): nenhuma try contada duas vezes.
      expect(ev.resultado.somas).toEqual({
        [c.pessoas.A.characterId]: 1,
        [c.pessoas.B.characterId]: 3,
      });
    });

    it('lê do WCL exatamente os reports congelados no Auditar (T-A12)', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      const { porta, lidos } = wcl(semanaPadrao(c));
      await new CalculoService(repo, porta, depoisDaQuinta).calcular(a.id);
      expect(lidos.sort()).toEqual(['Quinta1', 'Terca1']);
    });
  });

  describe('T-Q11 — a evidência gravada cobre a §15.10 (N1)', () => {
    type Pull = {
      session: string;
      report: string;
      fightId: number;
      encounterId: number;
      difficulty: number;
      kill: boolean;
      startTime: number;
      endTime: number;
      duracaoMs: number;
      mortes?: Array<{ quem: string; name: string; server: string; timestamp: number }>;
    };
    type Evidencia = {
      versao: number;
      algoritmo: string;
      computedAt: string;
      rodada: { roundId: string; auditId: string; attempt: number; candidatosCongeladosEm: string };
      pulls: Pull[];
      deduplicacao: {
        janelaMs: number;
        regra: string;
        pares: Array<{
          mantida: { report: string; fightId: number; startTime: number };
          descartada: { report: string; fightId: number; startTime: number };
          diferencaMs: number;
        }>;
      };
    };
    const evidenciaDe = async (auditId: string, marketId: string) =>
      (await resultadosDe(auditId)).find((r) => r.marketId === marketId)!
        .evidence as unknown as Evidencia;

    it('a pull identificada: report, fight, encounter, dificuldade, kill, início, fim e duração', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      await new CalculoService(repo, wcl(semanaPadrao(c)).porta, depoisDaQuinta).calcular(a.id);

      const ev = await evidenciaDe(a.id, c.m.topDps!.id);
      expect(ev.pulls).toEqual([
        {
          session: 'terca',
          report: 'Terca1',
          fightId: 3,
          encounterId: FARM,
          difficulty: 5,
          kill: true,
          startTime: TERCA_21H + 200_000,
          endTime: TERCA_21H + 500_000,
          duracaoMs: 300_000,
        },
      ]);
    });

    it('First Death: a sequência de mortes até a primeira elegível, com os de fora e o timestamp', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      await new CalculoService(repo, wcl(semanaPadrao(c)).porta, depoisDaQuinta).calcular(a.id);
      const { A, B, H } = c.pessoas;
      const morte = (quem: { characterId: string; name: string }, timestamp: number) => ({
        quem: quem.characterId,
        name: quem.name,
        server: 'Azralon',
        timestamp,
      });

      const farm = await evidenciaDe(a.id, c.m.fdFarm!.id);
      // H morre primeiro; A, depois, fica fora da sequência.
      expect(farm.pulls).toEqual([
        expect.objectContaining({
          report: 'Terca1',
          fightId: 3,
          kill: true,
          mortes: [morte(H, TERCA_21H + 250_000)],
        }),
      ]);

      const prog = await evidenciaDe(a.id, c.m.fdProg!.id);
      expect(prog.pulls.map((p) => [p.report, p.fightId, p.mortes])).toEqual([
        [
          'Terca1',
          1,
          [
            // O outsider morreu antes e foi pulado (D-13) — mas está na prova.
            { quem: 'fora:99', name: 'Outsider', server: 'Azralon', timestamp: TERCA_21H + 10_000 },
            morte(B, TERCA_21H + 11_000),
          ],
        ],
        ['Terca1', 2, [morte(B, TERCA_21H + 80_000)]],
        ['Quinta1', 1, [morte(A, QUINTA_21H + 5_000)]],
        ['Quinta1', 2, [morte(B, QUINTA_21H + 90_000)]],
      ]);
    });

    it('o vínculo com a rodada, a tentativa e o snapshot; computedAt e a versão do algoritmo', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      await new CalculoService(repo, wcl(semanaPadrao(c)).porta, depoisDaQuinta).calcular(a.id);

      const auditoria = await db.betAudit.findUniqueOrThrow({ where: { id: a.id } });
      const rodada = await db.betRound.findUniqueOrThrow({ where: { id: c.rodada.id } });
      const ev = await evidenciaDe(a.id, c.m.weekly!.id);
      expect(ev).toMatchObject({
        versao: 2,
        algoritmo: 'titanbet-2',
        computedAt: auditoria.calculatedAt!.toISOString(),
        rodada: {
          roundId: c.rodada.id,
          auditId: a.id,
          attempt: 1,
          candidatosCongeladosEm: rodada.readyAt!.toISOString(),
        },
      });
      // Weekly: a kill do boss de progressão, identificada.
      expect(ev.pulls).toEqual([
        expect.objectContaining({ report: 'Quinta1', fightId: 2, encounterId: PROG, kill: true }),
      ]);
    });

    it('os pares deduplicados e a regra usada (D-63)', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c, { terca: ['Terca1', 'Terca2'], quinta: ['Quinta1'] });
      const semana = semanaPadrao(c);
      const copia = {
        ...semana.Terca1,
        code: 'Terca2',
        startTime: semana.Terca1.startTime + 2_000,
      };
      await new CalculoService(
        repo,
        wcl({ ...semana, Terca2: copia }).porta,
        depoisDaQuinta,
      ).calcular(a.id);

      const prog = await evidenciaDe(a.id, c.m.fdProg!.id);
      expect(prog.deduplicacao.janelaMs).toBe(10_000);
      expect(prog.deduplicacao.regra).toMatch(/mesmo encounter/);
      expect(prog.deduplicacao.pares).toEqual([
        {
          mantida: { report: 'Terca1', fightId: 1, startTime: TERCA_21H },
          descartada: { report: 'Terca2', fightId: 1, startTime: TERCA_21H + 2_000 },
          diferencaMs: 2_000,
        },
        {
          mantida: { report: 'Terca1', fightId: 2, startTime: TERCA_21H + 70_000 },
          descartada: { report: 'Terca2', fightId: 2, startTime: TERCA_21H + 72_000 },
          diferencaMs: 2_000,
        },
      ]);
      // Só os pares do boss do mercado: o do farm fica nos mercados do farm.
      const top = await evidenciaDe(a.id, c.m.topDps!.id);
      expect(top.deduplicacao.pares.map((x) => x.mantida.fightId)).toEqual([3]);
    });

    it('a evidência atravessa o contrato de resultados sem perder nada', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      const servico = new CalculoService(repo, wcl(semanaPadrao(c)).porta, depoisDaQuinta);
      await servico.calcular(a.id);

      const lida = resultadosDaAuditoriaSchema.parse(
        JSON.parse(JSON.stringify(await servico.resultados(a.id))),
      );
      for (const r of await resultadosDe(a.id)) {
        const m = lida.mercados.find((x) => x.marketId === r.marketId)!;
        expect(m.evidencia).toEqual(r.evidence);
        expect(m.evidencia).toHaveProperty('pulls');
        expect(m.evidencia).toHaveProperty('rodada');
      }
    });
  });
});
