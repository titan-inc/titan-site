import { randomUUID } from 'node:crypto';
import type { BetCandidateRole } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import type { ReportDaGuilda } from '../../../src/titan-bet/auditoria';
import { AuditoriaService } from '../../../src/titan-bet/auditoria.service';
import { CalculoService } from '../../../src/titan-bet/calculo.service';
import type { LeituraDaKill, LeituraDoReport } from '../../../src/titan-bet/leitura-wcl';
import { congelarReport } from '../../../src/titan-bet/snapshot';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import { depoisDaQuinta, esperarPassar } from './ciclo';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * D-76 — o cenário que reproduziu o achado 5 (test-design §42.7, §43): o
 * Auditar congela a revisão A; o WCL passa a responder a revisão B; o Calcular
 * tem de dar exatamente o resultado e a evidência de A, sem ler o WCL.
 *
 * Todos os mercados (DPS, HPS, os dois Parse %, Dispels, First Death de farm e
 * de progressão, Weekly), dois reports na mesma terça (deduplicação), terça e
 * quinta, e um report sem fight relevante. Em B tudo se inverte: qualquer
 * leitura de B aparece no resultado.
 */
jest.setTimeout(120_000);

const FARM = 660001;
const PROG = 660002;
const FORA = 660999;
const DA_RODADA = [FARM, PROG];
const DIA = 24 * 60 * 60 * 1000;

type Revisao = 'A' | 'B';
type Pessoa = { id: string; name: string; role: BetCandidateRole; actor: number };

describe('Titan Bet — o Auditar congela, o Calcular não lê o WCL (D-76)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let repo: TitanBetRepository;
  let pessoas: Record<'A' | 'B' | 'H' | 'G', Pessoa>;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    repo = new TitanBetRepository(db);
    // As mesmas pessoas nas rodadas comparadas: a evidência cita os mesmos ids.
    const pessoa = async (role: BetCandidateRole, actor: number): Promise<Pessoa> => ({
      id: (await f.personagem()).id,
      name: `N${randomUUID().slice(0, 8)}`,
      role,
      actor,
    });
    pessoas = {
      A: await pessoa('Melee', 10),
      B: await pessoa('Ranged', 11),
      H: await pessoa('Heal', 12),
      G: await pessoa('Heal', 13),
    };
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Rodada com farm e progressão, todos os mercados e os quatro candidatos. */
  async function rodada(cutoffAt: Date) {
    const r = await f.rodada({ cutoffAt });
    const farm = await f.encounter(r.id, { encounterId: FARM, track: 'farm' });
    const prog = await f.encounter(r.id, { encounterId: PROG, track: 'progressao' });
    for (const kind of [
      'top_dps',
      'top_dps_parse',
      'top_hps',
      'top_hps_parse',
      'top_dispels',
      'first_death',
    ] as const) {
      await f.mercadoDeBoss(farm, kind);
    }
    await f.mercadoDeBoss(prog, 'first_death');
    await f.mercadoWeekly(r.id);
    for (const p of Object.values(pessoas)) {
      await db.betRoundCandidate.create({
        data: { roundId: r.id, characterId: p.id, role: p.role, name: p.name, realm: 'Azralon' },
      });
    }
    await f.pronta(r.id);
    return r;
  }

  // ─── O WCL falso: duas revisões da mesma semana ───────────────────────────

  function semana(cutoffAt: Date, rev: Revisao): Record<string, LeituraDoReport> {
    const { A, B, H, G } = pessoas;
    const emA = rev === 'A';
    const revision = emA ? 3 : 4;
    const terca = cutoffAt.getTime() + 1_000;
    const quinta = terca + 2 * DIA;
    const atores = Object.values(pessoas).map((p) => ({
      id: p.actor,
      name: p.name,
      server: 'Azralon',
    }));
    const linha = (p: Pessoa, total: number) => ({ id: p.actor, name: p.name, total });
    const rank = (p: Pessoa, rankPercent: number) => ({
      name: p.name,
      server: { name: 'Azralon' },
      spec: 'Spec',
      amount: 1,
      rankPercent,
      bracketPercent: 50,
    });
    // Em B, cada número e cada ordem se inverte.
    const [dps1, dps2] = emA ? [A, B] : [B, A];
    const [cura1, cura2] = emA ? [H, G] : [G, H];
    const killFarm: LeituraDaKill = {
      damage: [linha(dps1, 60_000_000), linha(dps2, 30_000_000)],
      healing: [linha(cura1, 40_000_000), linha(cura2, 20_000_000)],
      dispels: {
        entries: [
          {
            name: 'Debuff',
            entries: [{ name: 'Magia', details: [linha(cura1, 9), linha(cura2, 2)] }],
          },
        ],
      },
      rankingsDps: [rank(dps1, 95), rank(dps2, 40)],
      rankingsHps: [rank(cura1, 90), rank(cura2, 30)],
    };
    const terca1: LeituraDoReport = {
      code: 'Terca1',
      startTime: terca,
      revision,
      fights: [
        { id: 1, encounterID: FARM, difficulty: 5, kill: true, startTime: 0, endTime: 300_000 },
        {
          id: 2,
          encounterID: PROG,
          difficulty: 5,
          kill: false,
          startTime: 310_000,
          endTime: 370_000,
        },
      ],
      actors: atores,
      deaths: [
        { fight: 1, targetID: (emA ? B : A).actor, timestamp: 100_000 },
        { fight: 1, targetID: (emA ? A : B).actor, timestamp: 150_000 },
        { fight: 2, targetID: (emA ? A : B).actor, timestamp: 320_000 },
      ],
      kills: { 1: killFarm },
    };
    return {
      Terca1: terca1,
      // O segundo logger da terça: as mesmas pulls, 2 s depois (deduplicação).
      Terca2: { ...terca1, code: 'Terca2', startTime: terca + 2_000 },
      Quinta1: {
        code: 'Quinta1',
        startTime: quinta,
        revision,
        fights: [
          { id: 1, encounterID: PROG, difficulty: 5, kill: emA, startTime: 0, endTime: 200_000 },
        ],
        actors: atores,
        deaths: [{ fight: 1, targetID: (emA ? H : G).actor, timestamp: 10_000 }],
        kills: emA
          ? {
              1: {
                damage: [],
                healing: [],
                dispels: { entries: [] },
                rankingsDps: [],
                rankingsHps: [],
              },
            }
          : {},
      },
      // Report da quinta sem nenhum boss da rodada.
      Quinta2: {
        code: 'Quinta2',
        startTime: quinta + 60_000,
        revision,
        fights: [{ id: 1, encounterID: FORA, difficulty: 5, kill: true, startTime: 0, endTime: 1 }],
        actors: atores,
        deaths: [],
        kills: {},
      },
    };
  }

  /** O transporte do WCL: responde a revisão do momento, e conta as leituras. */
  function transporte(cutoffAt: Date) {
    const t = {
      revisao: 'A' as Revisao,
      leituras: 0,
      listagens: 0,
      listGuildReports: () => {
        t.listagens++;
        return Promise.resolve(
          Object.values(semana(cutoffAt, t.revisao)).map((r): ReportDaGuilda => ({
            code: r.code,
            title: 'titanbet',
            revision: r.revision,
            startTime: r.startTime,
          })),
        );
      },
      getTitanBetReport: (code: string, encounterIds: number[]) => {
        t.leituras++;
        expect(encounterIds.sort()).toEqual([...DA_RODADA].sort());
        return Promise.resolve(semana(cutoffAt, t.revisao)[code]!);
      },
    };
    return t;
  }

  async function auditar(roundId: string, t: ReturnType<typeof transporte>) {
    return new AuditoriaService(repo, t, depoisDaQuinta).auditar(roundId, {
      userId: 'officer-teste',
      battletag: 'Officer#0001',
    });
  }

  /**
   * Os resultados da tentativa, com os ids que são da rodada trocados pelo
   * que é igual entre rodadas — o encounter do WCL e o tipo do mercado —, e
   * sem o instante do cálculo. O resto tem de ser igual, byte a byte.
   */
  async function resultados(roundId: string, auditId: string) {
    const encounters = await db.betRoundEncounter.findMany({ where: { roundId } });
    const mercados = await db.betMarket.findMany({ where: { roundId } });
    const rs = await db.betMarketResult.findMany({
      where: { auditId },
      include: { winners: true, kills: true },
    });
    let json = JSON.stringify(
      rs.map((r) => ({
        mercado: r.marketId,
        outcome: r.outcome,
        validPool: r.validPool,
        winningStake: r.winningStake,
        vencedores: r.winners.map((w) => w.characterId).sort(),
        kills: r.kills.map((k) => k.roundEncounterId).sort(),
        evidence: r.evidence,
      })),
    );
    for (const e of encounters) json = json.split(e.id).join(`enc:${e.encounterId}`);
    for (const m of mercados) {
      const boss = encounters.find((e) => e.id === m.roundEncounterId)?.encounterId ?? 'rodada';
      json = json.split(m.id).join(`mkt:${m.kind}:${boss}`);
    }
    json = json.split(roundId).join('rodada').split(auditId).join('tentativa');
    // O instante do Ready também é da rodada: cada uma deu o seu.
    const { readyAt } = await db.betRound.findUniqueOrThrow({ where: { id: roundId } });
    json = json.split(readyAt!.toISOString()).join('ready');
    const lidos = JSON.parse(json) as Array<{
      mercado: string;
      evidence: Record<string, unknown>;
    }>;
    for (const r of lidos) delete r.evidence.computedAt;
    return lidos.sort((a, b) => a.mercado.localeCompare(b.mercado));
  }

  it('Auditar A → WCL passa a B → Calcular: resultado e evidência de A, sem ler o WCL', async () => {
    const cutoffAt = new Date(Date.now() + 8_000);
    const [principal, gemea, soB] = [
      await rodada(cutoffAt),
      await rodada(cutoffAt),
      await rodada(cutoffAt),
    ];
    await esperarPassar(db, cutoffAt);

    // 1. Auditar com o WCL na revisão A.
    const t = transporte(cutoffAt);
    const { auditId } = await auditar(principal.id, t);

    // 2. O snapshot A está persistido, report a report.
    const refs = await db.betAuditSourceReport.findMany({
      where: { source: { auditId } },
      orderBy: { reportCode: 'asc' },
    });
    const emA = semana(cutoffAt, 'A');
    expect(refs.map((r) => [r.reportCode, r.reportRevision])).toEqual([
      ['Quinta1', 3],
      ['Quinta2', 3],
      ['Terca1', 3],
      ['Terca2', 3],
    ]);
    for (const r of refs) {
      expect(r.snapshot).toEqual(congelarReport(emA[r.reportCode]!, 'titanbet', DA_RODADA));
    }

    // 3. O WCL passa a responder a revisão B.
    t.revisao = 'B';
    const [leiturasAntes, listagensAntes] = [t.leituras, t.listagens];

    // 4. Calcular — o serviço nem tem porta para o WCL.
    await new CalculoService(repo, depoisDaQuinta).calcular(auditId);

    // 5. Nenhuma leitura externa durante o cálculo.
    expect([t.leituras, t.listagens]).toEqual([leiturasAntes, listagensAntes]);

    // 6. Resultado e evidência: exatamente os de uma rodada que nunca viu B.
    const tg = transporte(cutoffAt);
    const aGemea = await auditar(gemea.id, tg);
    await new CalculoService(repo, depoisDaQuinta).calcular(aGemea.auditId);
    const deA = await resultados(gemea.id, aGemea.auditId);
    expect(await resultados(principal.id, auditId)).toEqual(deA);

    // E B daria outro resultado — o teste enxergaria qualquer leitura de B.
    const tb = transporte(cutoffAt);
    tb.revisao = 'B';
    const aB = await auditar(soB.id, tb);
    await new CalculoService(repo, depoisDaQuinta).calcular(aB.auditId);
    expect(await resultados(soB.id, aB.auditId)).not.toEqual(deA);

    // 7. O snapshot não muda depois do Auditar: o banco recusa.
    const emB = congelarReport(semana(cutoffAt, 'B').Terca1!, 'titanbet', DA_RODADA);
    expect(
      await escrita(
        db.betAuditSourceReport.update({
          where: { id: refs[2]!.id },
          data: { snapshot: { ...emB, revision: 3 } },
        }),
      ),
    ).toBe('trigger');
  });

  it('a evidência v2 sai dos snapshots: pulls, mortes, deduplicação entre reports e os valores de A', async () => {
    const cutoffAt = new Date(Date.now() + 8_000);
    const r = await rodada(cutoffAt);
    await esperarPassar(db, cutoffAt);
    const t = transporte(cutoffAt);
    const { auditId } = await auditar(r.id, t);
    t.revisao = 'B';
    await new CalculoService(repo, depoisDaQuinta).calcular(auditId);

    const rs = await db.betMarketResult.findMany({
      where: { auditId },
      include: { market: true, winners: true, kills: true },
    });
    const encounterDe = async (wcl: number) =>
      (await db.betRoundEncounter.findFirstOrThrow({ where: { roundId: r.id, encounterId: wcl } }))
        .id;
    const [farm, progId] = [await encounterDe(FARM), await encounterDe(PROG)];
    const de = (kind: string, encounter: string | null = farm) =>
      rs.find((x) => x.market.kind === kind && x.market.roundEncounterId === encounter)!;
    const vencedor = (kind: string) => de(kind).winners.map((w) => w.characterId);
    const { A, H } = pessoas;

    expect(vencedor('top_dps')).toEqual([A.id]);
    expect(vencedor('top_dps_parse')).toEqual([A.id]);
    expect(vencedor('top_hps')).toEqual([H.id]);
    expect(vencedor('top_hps_parse')).toEqual([H.id]);
    expect(vencedor('top_dispels')).toEqual([H.id]);
    // Farm: B morre primeiro em A.
    expect(vencedor('first_death')).toEqual([pessoas.B.id]);
    // Progressão: a try da terça (A primeiro) e a kill da quinta (H primeiro).
    const prog = de('first_death', progId);
    expect(prog.winners.map((w) => w.characterId).sort()).toEqual([A.id, H.id].sort());
    // Weekly: o boss de progressão morreu na quinta, em A.
    expect(de('weekly_progression', null).kills.map((k) => k.roundEncounterId)).toEqual([progId]);

    const ev = prog.evidence as {
      deduplicacao: {
        pares: Array<{ mantida: { report: string }; descartada: { report: string } }>;
      };
      pulls: Array<{ report: string; mortes: Array<{ quem: string }> }>;
      fontes: Array<{ code: string; revision: number }>;
    };
    // Os dois reports da terça viraram uma pull só.
    expect(ev.deduplicacao.pares.map((p) => [p.mantida.report, p.descartada.report])).toEqual([
      ['Terca1', 'Terca2'],
    ]);
    expect(ev.pulls.map((p) => [p.report, p.mortes[0]!.quem])).toEqual([
      ['Terca1', A.id],
      ['Quinta1', H.id],
    ]);
    // A proveniência na evidência é a do snapshot: revisão 3, nunca a 4.
    expect(new Set(ev.fontes.map((f) => f.revision))).toEqual(new Set([3]));
  });
});
