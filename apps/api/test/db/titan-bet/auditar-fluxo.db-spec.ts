import { auditoriaCorrenteSchema } from '@titan/shared';
import { PrismaService } from '../../../src/prisma/prisma.service';
import type { ReportDaGuilda } from '../../../src/titan-bet/auditoria';
import { AuditoriaRecusada, AuditoriaService } from '../../../src/titan-bet/auditoria.service';
import { CalculoService } from '../../../src/titan-bet/calculo.service';
import type { LeituraDoReport } from '../../../src/titan-bet/leitura-wcl';
import { congelarReport } from '../../../src/titan-bet/snapshot';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import { Fabrica } from './fabrica';
import { depoisDaQuinta } from './ciclo';

/**
 * Auditar — o fluxo (D-24, D-30, D-60, D-63; spec §7.2): T-A04, T-A05, T-A09,
 * T-A12, T-A16, T-A19, T-A21. titan-bet-test-design.md §3.7, §3.18, §40.
 *
 * O WCL é falso — a fonte é o que está sob teste, não a rede. Os horários são
 * de uma semana real: cutoff na terça 22/09/2026, 12:00 BRT (15:00 UTC).
 */
jest.setTimeout(30_000);

const OFFICER = { userId: 'officer-teste', battletag: 'Officer#0001' };
const OUTRO_OFFICER = { userId: 'officer-dois', battletag: 'Officer#0002' };
const CUTOFF = new Date('2026-09-22T15:00:00Z');

const brt = (data: string, hora: string) => new Date(`${data}T${hora}:00-03:00`).getTime();
const TERCA = brt('2026-09-22', '21:00');
const QUINTA = brt('2026-09-24', '20:30');

const report = (code: string, startTime: number, over: Partial<ReportDaGuilda> = {}) => ({
  code,
  title: 'titanbet',
  revision: 7,
  startTime,
  ...over,
});

describe('Titan Bet — Auditar (serviço + banco)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let repo: TitanBetRepository;
  let wcl: {
    listGuildReports: jest.Mock<Promise<ReportDaGuilda[]>, [Date, Date]>;
    getTitanBetReport: jest.Mock<Promise<LeituraDoReport>, [string, number[]]>;
  };
  let auditoria: AuditoriaService;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    repo = new TitanBetRepository(db);
  });

  /** O report como o WCL o leria: vazio, na revisão que a descoberta listou. */
  const leituraVazia = (code: string, revision: number): LeituraDoReport => ({
    code,
    startTime: TERCA,
    revision,
    fights: [],
    actors: [],
    deaths: [],
    kills: {},
  });

  beforeEach(() => {
    const listGuildReports = jest.fn<Promise<ReportDaGuilda[]>, [Date, Date]>();
    wcl = {
      listGuildReports,
      // A leitura do Auditar (D-76): o mesmo report, na revisão listada.
      getTitanBetReport: jest.fn<Promise<LeituraDoReport>, [string, number[]]>(async (code) => {
        const listados = await (listGuildReports.mock.results.at(-1)!.value as Promise<
          ReportDaGuilda[]
        >);
        return leituraVazia(code, listados.find((r) => r.code === code)!.revision);
      }),
    };
    auditoria = new AuditoriaService(repo, wcl, depoisDaQuinta);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Rodada que teve Ready e já passou do cutoff — onde o Auditar acontece. */
  function rodadaFechada() {
    return f.rodada({
      cutoffAt: CUTOFF,
      readyAt: new Date(CUTOFF.getTime() - 60 * 60 * 1000),
      readyByUserId: OFFICER.userId,
      readyByBattletag: OFFICER.battletag,
    });
  }

  const fontesDe = (auditId: string) =>
    db.betAuditSource.findMany({
      where: { auditId },
      orderBy: { session: 'asc' },
      include: { reports: { orderBy: { reportStartTime: 'asc' } } },
    });

  describe('T-A04 — caminho feliz: um `titanbet*` por sessão, sem seleção manual (D-30)', () => {
    it('duas fontes automáticas, auditoria pronta, officer e horário registrados', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([
        report('Terca1', TERCA, { title: 'TitanBet Tuesday' }),
        report('Comum1', TERCA, { title: 'Titan Inc Mythic' }),
        report('Quarta1', brt('2026-09-23', '21:00')),
        report('Quinta1', QUINTA, { revision: 12 }),
      ]);

      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);

      const a = await db.betAudit.findUniqueOrThrow({ where: { id: auditId } });
      expect(a).toMatchObject({
        roundId: rodada.id,
        attempt: 1,
        status: 'pronta',
        startedByUserId: OFFICER.userId,
        startedByBattletag: OFFICER.battletag,
      });
      const [terca, quinta] = await fontesDe(auditId);
      expect(terca).toMatchObject({
        session: 'terca',
        resolution: 'automatica',
        resolvedByUserId: null,
      });
      expect(terca!.reports).toMatchObject([
        {
          reportCode: 'Terca1',
          reportTitle: 'TitanBet Tuesday',
          reportRevision: 7,
          reportStartTime: new Date(TERCA),
        },
      ]);
      expect(quinta).toMatchObject({ session: 'quinta', resolution: 'automatica' });
      expect(quinta!.reports).toMatchObject([{ reportCode: 'Quinta1', reportRevision: 12 }]);
    });

    it('a janela pedida ao WCL começa no cutoff e cobre a quinta inteira', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([]);
      await auditoria.auditar(rodada.id, OFFICER);

      const [de, ate] = wcl.listGuildReports.mock.calls[0]!;
      expect(de.getTime()).toBeLessThanOrEqual(CUTOFF.getTime());
      expect(ate.getTime()).toBeGreaterThanOrEqual(brt('2026-09-24', '23:59'));
    });
  });

  describe('T-A05 — report ausente: para, não calcula, não vira `{}` (D-24)', () => {
    it('sem `titanbet*` na quinta → quinta `ausente`, auditoria aguardando revisão', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([
        report('Terca1', TERCA),
        report('Comum1', QUINTA, { title: 'raid de quinta' }),
      ]);

      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);

      const a = await db.betAudit.findUniqueOrThrow({ where: { id: auditId } });
      expect(a.status).toBe('aguardando_revisao');
      expect(a.calculatedAt).toBeNull();
      const [, quinta] = await fontesDe(auditId);
      expect(quinta).toMatchObject({ resolution: 'ausente', noRaidReason: null, reports: [] });
    });

    it('WCL fora do ar não vira auditoria nenhuma — lacuna não é resultado (§7.4)', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockRejectedValue(new Error('WCL 503'));
      await expect(auditoria.auditar(rodada.id, OFFICER)).rejects.toBeInstanceOf(AuditoriaRecusada);
      expect(await db.betAudit.count({ where: { roundId: rodada.id } })).toBe(0);
    });
  });

  // Mudança de produto (D-63, D-60): substitui o T-A06 ("vários candidatos: o
  // officer escolhe"). Vários `titanbet*` na sessão são todos fonte; a ação do
  // officer passa a ser declarar que não houve raid oficial.
  describe('T-A16 — todos os `titanbet*` da sessão são fonte (D-63)', () => {
    it('dois na terça → os dois usados, congelados, auditoria pronta — ninguém escolhe', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([
        report('TercaB', TERCA + 60_000, { title: 'titanbet 2', revision: 5 }),
        report('TercaA', TERCA, { revision: 3 }),
        report('Quinta1', QUINTA),
      ]);
      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);

      const a = await db.betAudit.findUniqueOrThrow({ where: { id: auditId } });
      expect(a.status).toBe('pronta');
      const [terca] = await fontesDe(auditId);
      expect(terca).toMatchObject({ resolution: 'automatica', resolvedByUserId: null });
      expect(terca!.reports.map((r) => [r.reportCode, r.reportRevision])).toEqual([
        ['TercaA', 3],
        ['TercaB', 5],
      ]);
    });

    it('o Officer Panel vê a tentativa com os reports, no contrato do shared', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([
        report('TercaA', TERCA),
        report('TercaB', TERCA + 60_000),
      ]);
      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);
      const vista = await auditoria.corrente(rodada.id);
      expect(auditoriaCorrenteSchema.parse(vista)).toEqual(vista);
      expect(vista).toMatchObject({ auditId, attempt: 1, status: 'aguardando_revisao' });
      expect(vista?.fontes.map((f) => [f.session, f.resolution, f.reports.length])).toEqual([
        ['terca', 'automatica', 2],
        ['quinta', 'ausente', 0],
      ]);
    });
  });

  describe('T-A19 — o officer declara "não houve raid oficial" (D-60)', () => {
    async function quintaAusente() {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([report('Terca1', TERCA)]);
      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);
      return { rodada, auditId };
    }

    it('sessão ausente → sem raid, com motivo, officer e horário; auditoria pronta', async () => {
      const { auditId } = await quintaAusente();
      await auditoria.declararSemRaid(auditId, 'quinta', 'raid cancelada', OUTRO_OFFICER);

      const [, quinta] = await fontesDe(auditId);
      expect(quinta).toMatchObject({
        resolution: 'sem_raid',
        noRaidReason: 'raid cancelada',
        resolvedByUserId: OUTRO_OFFICER.userId,
        resolvedByBattletag: OUTRO_OFFICER.battletag,
        reports: [],
      });
      expect(quinta!.resolvedAt).toBeInstanceOf(Date);
      const a = await db.betAudit.findUniqueOrThrow({ where: { id: auditId } });
      expect(a.status).toBe('pronta');
    });

    it('a ausência sozinha nunca resolve: a auditoria espera a declaração', async () => {
      const { auditId } = await quintaAusente();
      const a = await db.betAudit.findUniqueOrThrow({ where: { id: auditId } });
      expect(a.status).toBe('aguardando_revisao');
    });

    it('sessão que tem report não se declara sem raid', async () => {
      const { auditId } = await quintaAusente();
      await expect(
        auditoria.declararSemRaid(auditId, 'terca', 'engano', OFFICER),
      ).rejects.toBeInstanceOf(AuditoriaRecusada);
      const [terca] = await fontesDe(auditId);
      expect(terca?.resolution).toBe('automatica');
    });

    it('motivo vazio → recusado, nada muda', async () => {
      const { auditId } = await quintaAusente();
      await expect(
        auditoria.declararSemRaid(auditId, 'quinta', '   ', OFFICER),
      ).rejects.toBeInstanceOf(AuditoriaRecusada);
      const [, quinta] = await fontesDe(auditId);
      expect(quinta?.resolution).toBe('ausente');
    });
  });

  // A validação com o WCL real (§40) injetou fontes abaixo da descoberta. Isto
  // prende o caminho normal: logs com a forma dos reais — dois loggers por
  // noite, nos dias e horários certos, sem o prefixo — nunca chegam ao motor.
  describe('T-A21 — o caminho normal não aceita o que só o harness injeta (§40)', () => {
    const naoTitanbet = [
      report('LogA1', TERCA, { title: 'raid de terça' }),
      report('LogA2', TERCA + 400, { title: 'outro logger' }),
      report('LogB1', QUINTA, { title: 'raid de quinta' }),
      report('LogB2', QUINTA + 2_100, { title: 'outro logger' }),
    ];

    it('sem `titanbet*`, nas sessões certas: nenhuma fonte, e o cálculo nem lê o WCL', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue(naoTitanbet);
      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);

      const fontes = await fontesDe(auditId);
      expect(fontes.map((x) => x.resolution)).toEqual(['ausente', 'ausente']);
      expect(fontes.flatMap((x) => x.reports)).toEqual([]);

      // O Calcular não tem WCL (D-76); e sem fonte, recusa.
      await expect(
        new CalculoService(repo, depoisDaQuinta).calcular(auditId),
      ).rejects.toBeInstanceOf(AuditoriaRecusada);
      expect(wcl.getTitanBetReport).not.toHaveBeenCalled();
    });

    it('`titanbet*` da semana anterior ao cutoff não entra na rodada', async () => {
      const rodada = await rodadaFechada();
      const semanaAnterior = TERCA - 7 * 24 * 60 * 60 * 1000;
      wcl.listGuildReports.mockResolvedValue([
        report('Velho1', semanaAnterior, { title: 'titanbet' }),
        report('Terca1', TERCA),
      ]);
      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);
      const codes = (await fontesDe(auditId)).flatMap((x) => x.reports.map((r) => r.reportCode));
      expect(codes).toEqual(['Terca1']);
    });
  });

  describe('T-A30 — o Auditar congela os dados externos de cada report (D-76)', () => {
    const BOSS = 501;

    /** Rodada com um boss (501) no Ready, já fechada. */
    async function rodadaComBoss() {
      const rodada = await f.rodada({ cutoffAt: CUTOFF });
      await f.encounter(rodada.id, { encounterId: BOSS });
      return db.betRound.update({
        where: { id: rodada.id },
        data: {
          readyAt: new Date(CUTOFF.getTime() - 60 * 60 * 1000),
          readyByUserId: OFFICER.userId,
          readyByBattletag: OFFICER.battletag,
        },
      });
    }

    /** Uma leitura com uma fight do boss da rodada e uma de outro boss. */
    const leitura = (code: string, revision: number): LeituraDoReport => ({
      code,
      startTime: TERCA,
      revision,
      fights: [
        { id: 1, encounterID: BOSS, difficulty: 5, kill: true, startTime: 0, endTime: 300_000 },
        { id: 2, encounterID: 777, difficulty: 5, kill: true, startTime: 400_000, endTime: 1 },
      ],
      actors: [{ id: 10, name: 'Morto', server: 'Azralon' }],
      deaths: [
        { fight: 1, targetID: 10, timestamp: 5_000 },
        { fight: 2, targetID: 10, timestamp: 401_000 },
      ],
      kills: {},
    });

    const referencias = (roundId: string) =>
      db.betAuditSourceReport.findMany({
        where: { source: { audit: { roundId } } },
        orderBy: { reportStartTime: 'asc' },
      });

    it('terça e quinta: cada report com o seu snapshot — proveniência e só o que a rodada usa', async () => {
      const rodada = await rodadaComBoss();
      wcl.listGuildReports.mockResolvedValue([
        report('Terca1', TERCA, { revision: 7 }),
        report('Quinta1', QUINTA, { title: 'TitanBet quinta', revision: 12 }),
      ]);
      wcl.getTitanBetReport.mockImplementation((code) =>
        Promise.resolve(leitura(code, code === 'Terca1' ? 7 : 12)),
      );

      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);

      expect(wcl.getTitanBetReport.mock.calls).toEqual([
        ['Terca1', [BOSS]],
        ['Quinta1', [BOSS]],
      ]);
      const refs = await referencias(rodada.id);
      expect(refs.map((r) => r.snapshot)).toEqual([
        congelarReport(leitura('Terca1', 7), 'titanbet', [BOSS]),
        congelarReport(leitura('Quinta1', 12), 'TitanBet quinta', [BOSS]),
      ]);
      // O boss fora da rodada, e a morte nele, não entram.
      expect(refs[0]!.snapshot).toMatchObject({
        versao: 1,
        code: 'Terca1',
        revision: 7,
        fights: [{ id: 1, encounterID: BOSS }],
        deaths: [{ fight: 1, targetID: 10, timestamp: 5_000 }],
      });
      expect((await db.betAudit.findUniqueOrThrow({ where: { id: auditId } })).status).toBe(
        'pronta',
      );
    });

    it('vários reports na mesma sessão: um snapshot por report', async () => {
      const rodada = await rodadaComBoss();
      wcl.listGuildReports.mockResolvedValue([
        report('TercaA', TERCA, { revision: 3 }),
        report('TercaB', TERCA + 2_000, { revision: 5 }),
      ]);
      wcl.getTitanBetReport.mockImplementation((code) =>
        Promise.resolve(leitura(code, code === 'TercaA' ? 3 : 5)),
      );
      await auditoria.auditar(rodada.id, OFFICER);
      expect(
        (await referencias(rodada.id)).map((r) => {
          const s = r.snapshot as { code: string; revision: number };
          return [r.reportCode, s.code, s.revision];
        }),
      ).toEqual([
        ['TercaA', 'TercaA', 3],
        ['TercaB', 'TercaB', 5],
      ]);
    });

    it('report sem fight relevante: congelado vazio, com a proveniência', async () => {
      const rodada = await rodadaComBoss();
      wcl.listGuildReports.mockResolvedValue([report('Terca1', TERCA), report('Quinta1', QUINTA)]);
      await auditoria.auditar(rodada.id, OFFICER);
      const [terca] = await referencias(rodada.id);
      expect(terca!.snapshot).toMatchObject({ code: 'Terca1', revision: 7, fights: [], kills: {} });
    });

    it('o WCL falha no segundo report: Auditar recusado, nenhuma tentativa, nenhuma fonte', async () => {
      const rodada = await rodadaComBoss();
      wcl.listGuildReports.mockResolvedValue([report('Terca1', TERCA), report('Quinta1', QUINTA)]);
      wcl.getTitanBetReport.mockImplementation((code) =>
        code === 'Quinta1'
          ? Promise.reject(new Error('WCL 503'))
          : Promise.resolve(leitura(code, 7)),
      );

      await expect(auditoria.auditar(rodada.id, OFFICER)).rejects.toThrow(/Quinta1/);
      expect(await db.betAudit.count({ where: { roundId: rodada.id } })).toBe(0);
      expect(await referencias(rodada.id)).toEqual([]);
    });

    it('a revisão lida difere da descoberta: recusado, nada congelado', async () => {
      const rodada = await rodadaComBoss();
      wcl.listGuildReports.mockResolvedValue([report('Terca1', TERCA, { revision: 7 })]);
      wcl.getTitanBetReport.mockImplementation((code) => Promise.resolve(leitura(code, 8)));

      await expect(auditoria.auditar(rodada.id, OFFICER)).rejects.toThrow(/revisão/);
      expect(await db.betAudit.count({ where: { roundId: rodada.id } })).toBe(0);
    });

    it('refazer com falha não mexe na tentativa anterior, que continua utilizável', async () => {
      const rodada = await rodadaComBoss();
      wcl.listGuildReports.mockResolvedValue([report('Terca1', TERCA), report('Quinta1', QUINTA)]);
      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);

      wcl.getTitanBetReport.mockRejectedValue(new Error('WCL 503'));
      await expect(auditoria.auditar(rodada.id, OUTRO_OFFICER)).rejects.toBeInstanceOf(
        AuditoriaRecusada,
      );
      const todas = await db.betAudit.findMany({ where: { roundId: rodada.id } });
      expect(todas).toEqual([expect.objectContaining({ id: auditId, status: 'pronta' })]);
    });
  });

  describe('T-A09 — refazer a auditoria cria outra tentativa (D-30)', () => {
    it('a anterior fica `substituida`, apontando a nova, com as fontes intactas', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([report('Terca1', TERCA)]);
      const primeira = await auditoria.auditar(rodada.id, OFFICER);
      const fontesAntes = await fontesDe(primeira.auditId);

      wcl.listGuildReports.mockResolvedValue([report('Terca1', TERCA), report('Quinta1', QUINTA)]);
      const segunda = await auditoria.auditar(rodada.id, OUTRO_OFFICER);

      const [a1, a2] = await db.betAudit.findMany({
        where: { roundId: rodada.id },
        orderBy: { attempt: 'asc' },
      });
      expect(a1).toMatchObject({ status: 'substituida', supersededByAuditId: segunda.auditId });
      expect(a2).toMatchObject({ id: segunda.auditId, attempt: 2, status: 'pronta' });
      expect(await fontesDe(primeira.auditId)).toEqual(fontesAntes);
    });

    it('rodada com auditoria confirmada não se audita de novo', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([report('Terca1', TERCA), report('Quinta1', QUINTA)]);
      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);
      await db.betAudit.update({
        where: { id: auditId },
        data: {
          status: 'confirmada',
          confirmedAt: new Date(),
          confirmedByUserId: OFFICER.userId,
          confirmedByBattletag: OFFICER.battletag,
        },
      });

      await expect(auditoria.auditar(rodada.id, OFFICER)).rejects.toBeInstanceOf(AuditoriaRecusada);
      expect(await db.betAudit.count({ where: { roundId: rodada.id } })).toBe(1);
    });
  });

  // Mudança de produto (D-63): o T-A12 aqui testava a escolha do officer sobre o
  // candidato gravado. O congelamento continua: a referência lida fica nos
  // reports da fonte, e refazer o Auditar é outra tentativa (T-A09). Que o
  // cálculo lê exatamente esses reports é o T-A12 em calculo.db-spec.ts.
  describe('T-A12 — a referência lida fica congelada na fonte (D-30, §15.10)', () => {
    it('o WCL mudar a revisão depois não muda a fonte gravada', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([report('Terca1', TERCA, { revision: 3 })]);
      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);

      wcl.listGuildReports.mockResolvedValue([report('Terca1', TERCA, { revision: 99 })]);
      const [terca] = await fontesDe(auditId);
      expect(terca?.reports.map((r) => r.reportRevision)).toEqual([3]);
    });
  });

  describe('quando o Auditar vale (§16.2, §16.5)', () => {
    it('antes do cutoff → recusado: apostas ainda abertas', async () => {
      const rodada = await f.rodada({ cutoffAt: new Date(Date.now() + 60 * 60 * 1000) });
      await f.pronta(rodada.id);
      // O relógio do sistema, não o "depois da quinta": o cutoff aqui é daqui a 1h.
      const agoraDeVerdade = new AuditoriaService(repo, wcl);
      await expect(agoraDeVerdade.auditar(rodada.id, OFFICER)).rejects.toThrow(
        /apostas ainda estão abertas/,
      );
      expect(wcl.listGuildReports).not.toHaveBeenCalled();
    });

    it('rodada que nunca teve Ready → recusado: não houve aposta', async () => {
      const rodada = await f.rodada({ cutoffAt: CUTOFF });
      await expect(auditoria.auditar(rodada.id, OFFICER)).rejects.toBeInstanceOf(AuditoriaRecusada);
    });

    it('rodada inexistente → recusado', async () => {
      await expect(auditoria.auditar('nao-existe', OFFICER)).rejects.toBeInstanceOf(
        AuditoriaRecusada,
      );
    });
  });
});
