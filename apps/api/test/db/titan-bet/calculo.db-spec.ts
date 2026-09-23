import { randomUUID } from 'node:crypto';
import type { BetCandidateRole, BetMarketKind } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { AuditoriaRecusada } from '../../../src/titan-bet/auditoria.service';
import { CalculoService, type ReportsParaCalculo } from '../../../src/titan-bet/calculo.service';
import type { LeituraDaKill, LeituraDoReport } from '../../../src/titan-bet/leitura-wcl';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import type { RaidCatalog } from '../../../src/warcraftlogs/warcraftlogs.service';
import { esperarPassar } from './ciclo';
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
const FORA = 880003; // boss do catálogo que não está na rodada

const CATALOGO: RaidCatalog = {
  encounters: new Map(
    [FARM, PROG, FORA].map((id, i) => [
      id,
      { id, name: `Boss ${i}`, zoneId: 88, zoneName: 'Raid', order: i },
    ]),
  ),
  zones: new Map(),
  difficultyNames: new Map(),
};

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
      inWeeklyProgression: true,
    });
    const prog = await f.encounter(rodada.id, {
      encounterId: PROG,
      track: 'progressao',
      inWeeklyProgression: true,
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
      weekly: string[] = [],
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
        },
      });
      for (const roundEncounterId of weekly) {
        await db.betWeeklySelection.create({
          data: {
            betId: bet.id,
            roundId: rodada.id,
            marketKind: kind,
            roundEncounterId,
            inWeeklyProgression: true,
          },
        });
      }
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

    return { rodada, farm, prog, m, pessoas, apostar };
  }

  type Cenario = Awaited<ReturnType<typeof cenario>>;

  /** Depois do cutoff: a auditoria `pronta` com as duas fontes congeladas. */
  async function auditoriaPronta(c: Cenario) {
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
    for (const [session, code] of [
      ['terca', 'Terca1'],
      ['quinta', 'Quinta1'],
    ] as const) {
      await db.betAuditSource.create({
        data: {
          auditId: auditoria.id,
          session,
          resolution: 'automatica',
          reportCode: code,
          reportTitle: 'titanbet',
          reportRevision: 3,
          reportStartTime: new Date(),
          candidates: [],
        },
      });
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
  ): LeituraDoReport {
    return {
      code,
      startTime: 1_000_000,
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
      getRaidCatalog: () => Promise.resolve(CATALOGO),
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

      await new CalculoService(repo, wcl(semanaPadrao(c)).porta).calcular(a.id);

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
        algorithmVersion: 'titanbet-1',
      });
      expect(top.winners.map((w) => w.characterId)).toEqual([c.pessoas.A.characterId]);
    });
  });

  describe('T-Q02 — First Death de farm e de progressão (D-13, D-14, D-29)', () => {
    it('farm: na kill, H morre primeiro; progressão: B 2 (terça) × A 1 (quinta) → B', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      await new CalculoService(repo, wcl(semanaPadrao(c)).porta).calcular(a.id);
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

  describe('T-Q03 — Weekly: K gravado; W das apostas no conjunto exato (D-05)', () => {
    it('K = {farm, prog}; a aposta nos dois vence, a só no farm perde', async () => {
      const c = await cenario();
      await c.apostar(c.m.weekly!.id, 'weekly_progression', 500, null, [c.farm.id, c.prog.id]);
      await c.apostar(c.m.weekly!.id, 'weekly_progression', 300, null, [c.farm.id]);
      const a = await auditoriaPronta(c);
      await new CalculoService(repo, wcl(semanaPadrao(c)).porta).calcular(a.id);

      const w = (await resultadosDe(a.id)).find((r) => r.marketId === c.m.weekly!.id)!;
      expect(w).toMatchObject({ outcome: 'vencedores', validPool: 800, winningStake: 500 });
      expect(w.kills.map((k) => k.roundEncounterId).sort()).toEqual([c.farm.id, c.prog.id].sort());
      expect(w.winners).toHaveLength(0);
    });
  });

  describe('T-Q04 — Parse % congelado na evidência (D-43, T-F06)', () => {
    it('grava rankPercent e a variante; o WCL mudar depois não muda o resultado', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      const semana = semanaPadrao(c, 95);
      await new CalculoService(repo, wcl(semana).porta).calcular(a.id);

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
      await expect(new CalculoService(repo, depois).calcular(a.id)).rejects.toBeInstanceOf(
        AuditoriaRecusada,
      );
      const agora = (await resultadosDe(a.id)).find((r) => r.marketId === c.m.parse!.id)!;
      expect(agora.evidence).toEqual(antes.evidence);
    });
  });

  describe('T-Q05 — proposta de VOID e W = 0 ficam como resultado, não como decisão', () => {
    it('sem kill do farm na semana → mercados do farm `anulado` com motivo', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      const semana = semanaPadrao(c);
      semana.Terca1.fights = semana.Terca1.fights.filter((x) => x.encounterID !== FARM);
      await new CalculoService(repo, wcl(semana).porta).calcular(a.id);

      const top = (await resultadosDe(a.id)).find((r) => r.marketId === c.m.topDps!.id)!;
      expect(top).toMatchObject({
        outcome: 'anulado',
        voidReason: 'sem_kill',
        prizePool: null,
        winningStake: null,
      });
    });

    it('ninguém apostou no vencedor → `vencedores` com W = 0 (a D-44 é no settlement)', async () => {
      const c = await cenario();
      await c.apostar(c.m.topDps!.id, 'top_dps', 700, c.pessoas.B);
      const a = await auditoriaPronta(c);
      await new CalculoService(repo, wcl(semanaPadrao(c)).porta).calcular(a.id);

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
        new CalculoService(repo, wcl(semanaPadrao(c)).porta).calcular(a.id),
      ).rejects.toBeInstanceOf(AuditoriaRecusada);
      expect(await db.betMarketResult.count({ where: { auditId: a.id } })).toBe(0);
    });

    it('duas kills do mesmo boss na semana → revisão (§7.2, OQ-40)', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      const semana = semanaPadrao(c);
      semana.Quinta1.fights.push({
        id: 9,
        encounterID: FARM,
        difficulty: 5,
        kill: true,
        startTime: 400_000,
        endTime: 600_000,
      });
      semana.Quinta1.kills[9] = semKill();
      await expect(new CalculoService(repo, wcl(semana).porta).calcular(a.id)).rejects.toThrow(
        /kills do mesmo boss/,
      );
      expect(await db.betMarketResult.count({ where: { auditId: a.id } })).toBe(0);
      expect((await db.betAudit.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('pronta');
    });

    it('kill Mythic de boss fora da Weekly → recusa: `K` depende da OQ-47', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      const semana = semanaPadrao(c);
      semana.Quinta1.fights.push({
        id: 8,
        encounterID: FORA,
        difficulty: 5,
        kill: true,
        startTime: 400_000,
        endTime: 600_000,
      });
      await expect(new CalculoService(repo, wcl(semana).porta).calcular(a.id)).rejects.toThrow(
        /OQ-47/,
      );
      expect(await db.betMarketResult.count({ where: { auditId: a.id } })).toBe(0);
    });

    it('lê do WCL exatamente os reports congelados no Auditar (T-A12)', async () => {
      const c = await cenario();
      const a = await auditoriaPronta(c);
      const { porta, lidos } = wcl(semanaPadrao(c));
      await new CalculoService(repo, porta).calcular(a.id);
      expect(lidos.sort()).toEqual(['Quinta1', 'Terca1']);
    });
  });
});
