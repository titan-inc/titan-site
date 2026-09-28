import { randomUUID } from 'node:crypto';
import { rodadasDoOfficerSchema, slipsSubmetidosSchema } from '@titan/shared';
import { CharactersRepository } from '../../../src/characters/characters.repository';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ApostasService } from '../../../src/titan-bet/apostas.service';
import { AuditoriaService } from '../../../src/titan-bet/auditoria.service';
import { CalculoService } from '../../../src/titan-bet/calculo.service';
import {
  CancelamentoRecusado,
  CancelamentoService,
} from '../../../src/titan-bet/cancelamento.service';
import { ClosingRepository } from '../../../src/titan-bet/closing.repository';
import { ClosingService } from '../../../src/titan-bet/closing.service';
import { DepositoService } from '../../../src/titan-bet/deposito.service';
import { ElegibilidadeService } from '../../../src/titan-bet/elegibilidade.service';
import { PreparacaoService } from '../../../src/titan-bet/preparacao.service';
import { ReadyService } from '../../../src/titan-bet/ready.service';
import { RodadasService } from '../../../src/titan-bet/rodadas.service';
import { LedgerService, SettlementService } from '../../../src/titan-bet/settlement.service';
import { congelarReport } from '../../../src/titan-bet/snapshot';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import type { BlizzardService } from '../../../src/blizzard/blizzard.service';
import type { WowAuditService } from '../../../src/wowaudit/wowaudit.service';
import { depoisDaQuinta, esperarPassar } from './ciclo';
import { depositante, Fabrica } from './fabrica';

/**
 * D-77 — cancelamento administrativo de rodada, serviço + banco (T-X06 a T-X12;
 * titan-bet-test-design.md §44).
 */
jest.setTimeout(120_000);

const OFFICER = { userId: 'officer-teste', battletag: 'Officer#0001' };
const OUTRO = { userId: 'officer-dois', battletag: 'Officer#0002' };
const MOTIVO = 'a raid da semana foi cancelada pela liderança';

describe('Titan Bet — cancelamento administrativo (serviço + banco)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let repo: TitanBetRepository;
  let apostas: ApostasService;
  let deposito: DepositoService;
  let cancelamento: CancelamentoService;
  let rodadas: RodadasService;
  let ledger: LedgerService;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    repo = new TitanBetRepository(db);
    const elegibilidade = new ElegibilidadeService(repo);
    apostas = new ApostasService(repo, elegibilidade, new CharactersRepository(db));
    deposito = new DepositoService(repo);
    cancelamento = new CancelamentoService(repo);
    rodadas = new RodadasService(repo, elegibilidade);
    ledger = new LedgerService(repo);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /**
   * Rodada aberta: um boss com Top DPS, um candidato e `contas` apostadores, cada
   * um com o próprio personagem no snapshot de bettors.
   */
  async function cenario(contas = 4, cutoffEmMs = 60 * 60 * 1000) {
    const rodada = await f.rodada({ cutoffAt: new Date(Date.now() + cutoffEmMs) });
    const boss = await f.encounter(rodada.id);
    const topDps = await f.mercadoDeBoss(boss, 'top_dps');
    const alvo = await f.personagem();
    await f.candidato(rodada.id, alvo.id, 'Melee');
    const pessoas = [];
    for (let i = 0; i < contas; i++) {
      const pj = await f.personagem();
      await f.bettor(rodada.id, pj.id);
      pessoas.push(pj);
    }
    await f.pronta(rodada.id);
    const membros = [];
    for (const pj of pessoas) {
      const user = await db.user.create({
        data: {
          battlenetId: randomUUID(),
          battletag: `Apostador${randomUUID().slice(0, 4)}#1`,
          membership: 'member',
        },
      });
      await db.guildCharacter.create({ data: { userId: user.id, characterId: pj.id, rank: 5 } });
      membros.push({ conta: { userId: user.id, battletag: user.battletag }, pj });
    }
    const aposta = (stake = 300) => ({
      apostas: [{ marketId: topDps.id, stake, targetCharacterId: alvo.id }],
    });
    return { rodada, boss, topDps, alvo, membros, aposta };
  }
  type Cenario = Awaited<ReturnType<typeof cenario>>;

  /** Um slip em cada estado ativo, e um recusado: rascunho, pendente, válido, recusado. */
  async function slipsEmTodosOsEstados(c: Cenario) {
    const [m0, m1, m2, m3] = c.membros;
    const rascunho = await apostas.salvar(c.rodada.id, m0!.conta, c.aposta(200));
    const pendente = await apostas.salvar(c.rodada.id, m1!.conta, c.aposta(300));
    await apostas.submeter(c.rodada.id, m1!.conta, depositante(m1!.pj));
    const valido = await apostas.salvar(c.rodada.id, m2!.conta, c.aposta(400));
    await apostas.submeter(c.rodada.id, m2!.conta, depositante(m2!.pj));
    await deposito.confirmar(valido.slipId, OFFICER);
    const recusado = await apostas.salvar(c.rodada.id, m3!.conta, c.aposta(500));
    await apostas.submeter(c.rodada.id, m3!.conta, depositante(m3!.pj));
    await deposito.recusar(recusado.slipId, OFFICER, 'depósito não encontrado');
    return {
      rascunho: rascunho.slipId,
      pendente: pendente.slipId,
      valido: valido.slipId,
      recusado: recusado.slipId,
    };
  }

  const faseDe = async (roundId: string) =>
    (await rodadas.doOfficer()).rodadas.find((r) => r.roundId === roundId)!;

  /** A tentativa gravada pela porta do Auditar, com os snapshots (D-76). */
  async function auditoriaPronta(roundId: string) {
    const congelado = (code: string) => ({
      code,
      title: 'titanbet',
      revision: 1,
      startTime: 0,
      snapshot: congelarReport(
        { code, startTime: 0, revision: 1, fights: [], actors: [], deaths: [], kills: {} },
        'titanbet',
        [],
      ),
    });
    return repo.gravarAuditoria({
      roundId,
      officer: OFFICER,
      status: 'pronta',
      fontes: [
        { session: 'terca', resolution: 'automatica', reports: [congelado('T1')] },
        { session: 'quinta', resolution: 'automatica', reports: [congelado('Q1')] },
      ],
    });
  }

  describe('T-X06 — quando se cancela', () => {
    it('em preparação, aberta, fechada, auditando e calculada', async () => {
      const preparando = await f.rodada({ cutoffAt: new Date(Date.now() + 3_600_000) });
      await cancelamento.cancelar(preparando.id, OFFICER, MOTIVO);
      expect((await faseDe(preparando.id)).fase).toBe('CANCELLED');

      const aberta = await cenario(1);
      await cancelamento.cancelar(aberta.rodada.id, OFFICER, MOTIVO);
      expect((await faseDe(aberta.rodada.id)).fase).toBe('CANCELLED');

      for (const ate of ['BETTING_CLOSED', 'AUDITING', 'CALCULATED'] as const) {
        const c = await cenario(1, 3_000);
        await esperarPassar(db, c.rodada.cutoffAt);
        if (ate !== 'BETTING_CLOSED') {
          const { auditId } = await auditoriaPronta(c.rodada.id);
          if (ate === 'CALCULATED') {
            await new CalculoService(repo, depoisDaQuinta).calcular(auditId);
          }
        }
        expect((await faseDe(c.rodada.id)).fase).toBe(ate);
        await cancelamento.cancelar(c.rodada.id, OFFICER, MOTIVO);
        expect((await faseDe(c.rodada.id)).fase).toBe('CANCELLED');
      }
    });

    it('liquidada (settlement confirmado), fechada ou já cancelada → recusado', async () => {
      const c = await cenario(1, 3_000);
      await esperarPassar(db, c.rodada.cutoffAt);
      const { auditId } = await auditoriaPronta(c.rodada.id);
      await new CalculoService(repo, depoisDaQuinta).calcular(auditId);
      await new SettlementService(repo, depoisDaQuinta).confirmar(auditId, OFFICER);
      await expect(cancelamento.cancelar(c.rodada.id, OFFICER, MOTIVO)).rejects.toBeInstanceOf(
        CancelamentoRecusado,
      );

      await new ClosingService(new ClosingRepository(db)).publicar(c.rodada.id, OFFICER);
      await expect(cancelamento.cancelar(c.rodada.id, OFFICER, MOTIVO)).rejects.toBeInstanceOf(
        CancelamentoRecusado,
      );
      expect(
        (await db.betRound.findUniqueOrThrow({ where: { id: c.rodada.id } })).cancelledAt,
      ).toBeNull();

      const outra = await cenario(1);
      await cancelamento.cancelar(outra.rodada.id, OFFICER, MOTIVO);
      await expect(cancelamento.cancelar(outra.rodada.id, OUTRO, 'de novo')).rejects.toThrow(
        /cancelada/,
      );
    });

    it('sem motivo → recusado, nada muda; rodada inexistente → recusado', async () => {
      const c = await cenario(1);
      await expect(cancelamento.cancelar(c.rodada.id, OFFICER, '   ')).rejects.toBeInstanceOf(
        CancelamentoRecusado,
      );
      expect((await faseDe(c.rodada.id)).fase).toBe('OPEN');
      await expect(cancelamento.cancelar('nao-existe', OFFICER, MOTIVO)).rejects.toBeInstanceOf(
        CancelamentoRecusado,
      );
    });
  });

  describe('T-X07/T-X08 — o que o cancelamento faz', () => {
    it('os três ativos → cancelado; recusado intacto; nada apagado; nenhum lançamento novo', async () => {
      const c = await cenario();
      const s = await slipsEmTodosOsEstados(c);
      const antes = {
        slips: await db.betSlip.findMany({
          where: { roundId: c.rodada.id },
          orderBy: { id: 'asc' },
        }),
        bets: await db.bet.findMany({ where: { roundId: c.rodada.id }, orderBy: { id: 'asc' } }),
        ledger: await db.goldLedgerEntry.findMany({ where: { roundId: c.rodada.id } }),
      };

      await cancelamento.cancelar(c.rodada.id, OFFICER, MOTIVO);

      const status = async (id: string) =>
        (await db.betSlip.findUniqueOrThrow({ where: { id } })).status;
      expect(await status(s.rascunho)).toBe('cancelado');
      expect(await status(s.pendente)).toBe('cancelado');
      expect(await status(s.valido)).toBe('cancelado');
      expect(await status(s.recusado)).toBe('recusado');

      // Nada apagado; nada além do status mudou nos slips; apostas e ledger iguais.
      const depois = await db.betSlip.findMany({
        where: { roundId: c.rodada.id },
        orderBy: { id: 'asc' },
      });
      const semStatus = (x: object) =>
        Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'status' && k !== 'updatedAt'));
      expect(depois.map(semStatus)).toEqual(antes.slips.map(semStatus));
      expect(
        await db.bet.findMany({ where: { roundId: c.rodada.id }, orderBy: { id: 'asc' } }),
      ).toEqual(antes.bets);
      expect(await db.goldLedgerEntry.findMany({ where: { roundId: c.rodada.id } })).toEqual(
        antes.ledger,
      );
      // Nenhuma restituição, nenhum payout: o saldo devido segue zero.
      expect((await ledger.saldos(c.rodada.id)).saldos.every((x) => x.devido === 0)).toBe(true);
    });

    it('expirado intacto; válido depois do cutoff também cancela', async () => {
      const c = await cenario(2, 4_000);
      const pendente = await apostas.salvar(c.rodada.id, c.membros[0]!.conta, c.aposta());
      await apostas.submeter(c.rodada.id, c.membros[0]!.conta, depositante(c.membros[0]!.pj));
      const valido = await apostas.salvar(c.rodada.id, c.membros[1]!.conta, c.aposta());
      await apostas.submeter(c.rodada.id, c.membros[1]!.conta, depositante(c.membros[1]!.pj));
      await deposito.confirmar(valido.slipId, OFFICER);
      await esperarPassar(db, c.rodada.cutoffAt);
      await repo.expirarVencidos(new Date());

      await cancelamento.cancelar(c.rodada.id, OFFICER, MOTIVO);

      const status = async (id: string) =>
        (await db.betSlip.findUniqueOrThrow({ where: { id } })).status;
      expect(await status(pendente.slipId)).toBe('expirado');
      expect(await status(valido.slipId)).toBe('cancelado');
    });

    it('quem, quando e por quê: na rodada e no BetEvent', async () => {
      const c = await cenario();
      await slipsEmTodosOsEstados(c);
      await cancelamento.cancelar(c.rodada.id, OFFICER, `  ${MOTIVO}  `);

      const r = await db.betRound.findUniqueOrThrow({ where: { id: c.rodada.id } });
      expect(r).toMatchObject({
        cancelledByUserId: OFFICER.userId,
        cancelledByBattletag: OFFICER.battletag,
        cancellationReason: MOTIVO,
      });
      expect(r.cancelledAt).toBeInstanceOf(Date);
      const eventos = await db.betEvent.findMany({
        where: { roundId: c.rodada.id, type: 'rodada_cancelada' },
      });
      expect(eventos).toHaveLength(1);
      expect(eventos[0]).toMatchObject({
        actorUserId: OFFICER.userId,
        actorBattletag: OFFICER.battletag,
        payload: {
          motivo: MOTIVO,
          slipsCancelados: { rascunho: 1, aguardando_deposito: 1, valido: 1 },
        },
      });
    });

    it('o Officer Panel identifica o depósito confirmado a tratar fora do Titan Bet', async () => {
      const c = await cenario();
      const s = await slipsEmTodosOsEstados(c);
      await cancelamento.cancelar(c.rodada.id, OFFICER, MOTIVO);

      const lista = await deposito.submetidos(c.rodada.id);
      expect(slipsSubmetidosSchema.parse(lista)).toEqual(lista);
      const porId = new Map(lista.slips.map((x) => [x.slipId, x]));
      expect(porId.get(s.valido)).toMatchObject({
        status: 'cancelado',
        depositoConfirmado: true,
        expectedTotal: 400,
        depositCharacter: { name: c.membros[2]!.pj.name, realm: c.membros[2]!.pj.realm },
      });
      expect(porId.get(s.pendente)).toMatchObject({
        status: 'cancelado',
        depositoConfirmado: false,
      });
      expect(porId.get(s.rascunho)).toMatchObject({
        status: 'cancelado',
        depositoConfirmado: false,
        submittedAt: null,
      });
      expect(porId.get(s.recusado)).toMatchObject({
        status: 'recusado',
        depositoConfirmado: false,
      });

      const vista = await faseDe(c.rodada.id);
      expect(rodadasDoOfficerSchema.parse({ rodadas: [vista] })).toBeTruthy();
      expect(vista).toMatchObject({
        fase: 'CANCELLED',
        podeCancelar: false,
        podeAuditar: false,
        cancelamento: {
          motivo: MOTIVO,
          porBattletag: OFFICER.battletag,
          em: expect.any(String) as unknown,
        },
      });
    });
  });

  describe('T-X09 — atômico', () => {
    it('falha depois de gravar a rodada e os slips: nada fica cancelado', async () => {
      const c = await cenario();
      const s = await slipsEmTodosOsEstados(c);
      // Injeção de falha só neste banco de teste: o registro do evento é recusado.
      await db.$executeRawUnsafe(`
        CREATE FUNCTION teste_falha_no_evento() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW."roundId" = '${c.rodada.id}' AND NEW."type" = 'rodada_cancelada' THEN
            RAISE EXCEPTION 'falha injetada no teste';
          END IF;
          RETURN NEW;
        END $$`);
      await db.$executeRawUnsafe(
        `CREATE TRIGGER teste_falha_no_evento BEFORE INSERT ON "BetEvent" FOR EACH ROW EXECUTE FUNCTION teste_falha_no_evento()`,
      );
      try {
        await expect(cancelamento.cancelar(c.rodada.id, OFFICER, MOTIVO)).rejects.toBeInstanceOf(
          CancelamentoRecusado,
        );
      } finally {
        await db.$executeRawUnsafe(`DROP TRIGGER teste_falha_no_evento ON "BetEvent"`);
        await db.$executeRawUnsafe(`DROP FUNCTION teste_falha_no_evento()`);
      }
      expect(
        (await db.betRound.findUniqueOrThrow({ where: { id: c.rodada.id } })).cancelledAt,
      ).toBeNull();
      const status = async (id: string) =>
        (await db.betSlip.findUniqueOrThrow({ where: { id } })).status;
      expect([await status(s.rascunho), await status(s.pendente), await status(s.valido)]).toEqual([
        'rascunho',
        'aguardando_deposito',
        'valido',
      ]);
    });
  });

  describe('T-X10 — depois do cancelamento, nenhuma mutação', () => {
    it('apostas e depósito: salvar, submeter, confirmar, recusar', async () => {
      const c = await cenario();
      const s = await slipsEmTodosOsEstados(c);
      const [m0, m1] = c.membros;
      await cancelamento.cancelar(c.rodada.id, OFFICER, MOTIVO);

      await expect(apostas.salvar(c.rodada.id, m0!.conta, c.aposta(250))).rejects.toThrow();
      await expect(apostas.submeter(c.rodada.id, m0!.conta, depositante(m0!.pj))).rejects.toThrow();
      await expect(deposito.confirmar(s.pendente, OFFICER)).rejects.toThrow();
      await expect(deposito.recusar(s.pendente, OFFICER, 'x')).rejects.toThrow();
      // Um slip novo, de quem ainda não tinha, também não.
      await expect(apostas.salvar(c.rodada.id, m1!.conta, c.aposta(250))).rejects.toThrow();
      expect(
        await db.betSlip.count({ where: { roundId: c.rodada.id, status: { not: 'cancelado' } } }),
      ).toBe(1); // só o recusado
    });

    it('Auditar, sem raid, Calcular, confirmar, pagar, ajustar, Closing', async () => {
      const c = await cenario(1, 3_000);
      const slip = await apostas.salvar(c.rodada.id, c.membros[0]!.conta, c.aposta());
      await apostas.submeter(c.rodada.id, c.membros[0]!.conta, depositante(c.membros[0]!.pj));
      await deposito.confirmar(slip.slipId, OFFICER);
      await esperarPassar(db, c.rodada.cutoffAt);
      const semRaid = await repo.gravarAuditoria({
        roundId: c.rodada.id,
        officer: OFFICER,
        status: 'aguardando_revisao',
        fontes: [
          { session: 'terca', resolution: 'ausente', reports: [] },
          { session: 'quinta', resolution: 'ausente', reports: [] },
        ],
      });
      await cancelamento.cancelar(c.rodada.id, OFFICER, MOTIVO);

      const auditar = new AuditoriaService(
        repo,
        { listGuildReports: jest.fn(), getTitanBetReport: jest.fn() },
        depoisDaQuinta,
      );
      await expect(auditar.auditar(c.rodada.id, OFFICER)).rejects.toThrow(/cancelada/);
      await expect(
        auditar.declararSemRaid(semRaid.auditId, 'terca', 'não houve', OFFICER),
      ).rejects.toThrow();
      await expect(
        new CalculoService(repo, depoisDaQuinta).calcular(semRaid.auditId),
      ).rejects.toThrow();
      await expect(
        new SettlementService(repo, depoisDaQuinta).confirmar(semRaid.auditId, OFFICER),
      ).rejects.toThrow();
      await expect(ledger.pagar(slip.slipId, OFFICER)).rejects.toThrow();
      const deposito0 = await db.goldLedgerEntry.findFirstOrThrow({
        where: { slipId: slip.slipId, kind: 'deposito_validado' },
      });
      await expect(
        ledger.ajustar(
          { slipId: slip.slipId, amount: 10, reason: 'x', correctsEntryId: deposito0.id },
          OFFICER,
        ),
      ).rejects.toThrow();
      await expect(
        new ClosingService(new ClosingRepository(db)).publicar(c.rodada.id, OFFICER),
      ).rejects.toThrow();

      expect(await db.betAudit.count({ where: { roundId: c.rodada.id } })).toBe(1);
      expect(await db.goldLedgerEntry.count({ where: { roundId: c.rodada.id } })).toBe(1);
      expect(
        (await db.betAuditSource.findMany({ where: { auditId: semRaid.auditId } })).map(
          (x) => x.resolution,
        ),
      ).toEqual(['ausente', 'ausente']);
    });

    it('preparação e Ready de uma rodada cancelada em preparação', async () => {
      const rodada = await f.rodada({ cutoffAt: new Date(Date.now() + 3_600_000) });
      await cancelamento.cancelar(rodada.id, OFFICER, MOTIVO);
      const externo = () => {
        throw new Error('não deveria consultar fonte externa');
      };
      const prep = new PreparacaoService(
        repo,
        { getCurrentSeason: externo },
        { getRaidCatalog: externo },
        { zonaAtual: externo },
      );
      await expect(
        prep.salvar(rodada.id, { weekly: false, encounters: [] }, OFFICER),
      ).rejects.toThrow(/cancelada/);
      const ready = new ReadyService(
        repo,
        new CharactersRepository(db),
        { getGuildRosterSnapshot: externo } as unknown as BlizzardService,
        { getTeamCharactersSnapshot: externo } as unknown as WowAuditService,
      );
      await expect(ready.ready(rodada.id, OFFICER)).rejects.toThrow(/cancelada/);
      expect(
        (await db.betRound.findUniqueOrThrow({ where: { id: rodada.id } })).readyAt,
      ).toBeNull();
    });
  });

  describe('T-X11 — concorrência: nada é efetivado depois do cancelamento', () => {
    it('expiração espera o cancelamento em curso, sem expirar seus slips', async () => {
      const c = await cenario(1, 3_000);
      const slip = await apostas.salvar(c.rodada.id, c.membros[0]!.conta, c.aposta());
      await esperarPassar(db, c.rodada.cutoffAt);
      let travou!: () => void;
      let liberar!: () => void;
      const travada = new Promise<void>((resolve) => (travou = resolve));
      const liberada = new Promise<void>((resolve) => (liberar = resolve));
      const cancelando = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "BetRound" WHERE "id" = ${c.rodada.id} FOR NO KEY UPDATE`;
          travou();
          await liberada;
          await tx.betRound.update({
            where: { id: c.rodada.id },
            data: {
              cancelledAt: new Date(),
              cancelledByUserId: OFFICER.userId,
              cancelledByBattletag: OFFICER.battletag,
              cancellationReason: MOTIVO,
            },
          });
          await tx.betSlip.update({ where: { id: slip.slipId }, data: { status: 'cancelado' } });
        },
        { timeout: 10_000 },
      );
      await travada;
      let terminou = false;
      const expirando = repo.expirarVencidos(new Date()).then((r) => {
        terminou = true;
        return r;
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(terminou).toBe(false);
      } finally {
        liberar();
        await cancelando;
      }
      await expirando;
      expect(await db.betSlip.findUniqueOrThrow({ where: { id: slip.slipId } })).toMatchObject({
        status: 'cancelado',
        expiredAt: null,
      });
    });

    it('cancelar × confirmar depósito', async () => {
      for (let i = 0; i < 4; i++) {
        const c = await cenario(1);
        const slip = await apostas.salvar(c.rodada.id, c.membros[0]!.conta, c.aposta());
        await apostas.submeter(c.rodada.id, c.membros[0]!.conta, depositante(c.membros[0]!.pj));
        const [confirmou] = await Promise.allSettled([
          deposito.confirmar(slip.slipId, OFFICER),
          cancelamento.cancelar(c.rodada.id, OUTRO, MOTIVO),
        ]);
        const r = await db.betRound.findUniqueOrThrow({ where: { id: c.rodada.id } });
        const s = await db.betSlip.findUniqueOrThrow({ where: { id: slip.slipId } });
        const lancamentos = await db.goldLedgerEntry.findMany({ where: { roundId: c.rodada.id } });
        expect(r.cancelledAt).not.toBeNull();
        expect(s.status).toBe('cancelado');
        if (confirmou.status === 'fulfilled') {
          // Confirmou antes: o depósito conta, e o cancelamento veio depois.
          expect(s.validatedAt!.getTime()).toBeLessThanOrEqual(r.cancelledAt!.getTime());
          expect(lancamentos).toHaveLength(1);
        } else {
          expect(s.validatedAt).toBeNull();
          expect(lancamentos).toHaveLength(0);
        }
      }
    });

    it('determinístico: a mutação espera o cancelamento em curso e é recusada', async () => {
      const c = await cenario(1);
      const slip = await apostas.salvar(c.rodada.id, c.membros[0]!.conta, c.aposta());
      await apostas.submeter(c.rodada.id, c.membros[0]!.conta, depositante(c.membros[0]!.pj));

      // Um cancelamento que trava a rodada e demora a gravar — o mesmo que o
      // repositório faz, com uma pausa no meio.
      let travou: () => void = () => {};
      const travada = new Promise<void>((resolve) => (travou = resolve));
      const cancelando = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "BetRound" WHERE "id" = ${c.rodada.id} FOR NO KEY UPDATE`;
          travou();
          await new Promise((resolve) => setTimeout(resolve, 1_500));
          await tx.betRound.update({
            where: { id: c.rodada.id },
            data: {
              cancelledAt: new Date(),
              cancelledByUserId: OUTRO.userId,
              cancelledByBattletag: OUTRO.battletag,
              cancellationReason: MOTIVO,
            },
          });
          await tx.betSlip.updateMany({
            where: {
              roundId: c.rodada.id,
              status: { in: ['rascunho', 'aguardando_deposito', 'valido'] },
            },
            data: { status: 'cancelado' },
          });
        },
        { timeout: 10_000 },
      );
      await travada;
      const confirmando = deposito.confirmar(slip.slipId, OFFICER);

      await cancelando;
      await expect(confirmando).rejects.toThrow(/cancelada/);
      const s = await db.betSlip.findUniqueOrThrow({ where: { id: slip.slipId } });
      expect(s).toMatchObject({ status: 'cancelado', validatedAt: null });
      expect(await db.goldLedgerEntry.count({ where: { roundId: c.rodada.id } })).toBe(0);
    });

    it('cancelar × salvar aposta: nenhum rascunho ativo sobra', async () => {
      for (let i = 0; i < 4; i++) {
        const c = await cenario(1);
        await Promise.allSettled([
          apostas.salvar(c.rodada.id, c.membros[0]!.conta, c.aposta()),
          cancelamento.cancelar(c.rodada.id, OUTRO, MOTIVO),
        ]);
        expect(
          await db.betSlip.count({ where: { roundId: c.rodada.id, status: { not: 'cancelado' } } }),
        ).toBe(0);
      }
    });

    it('cancelar × confirmar a auditoria: um só vence — liquidada ou cancelada, nunca as duas', async () => {
      for (let i = 0; i < 3; i++) {
        const c = await cenario(1, 3_000);
        const slip = await apostas.salvar(c.rodada.id, c.membros[0]!.conta, c.aposta());
        await apostas.submeter(c.rodada.id, c.membros[0]!.conta, depositante(c.membros[0]!.pj));
        await deposito.confirmar(slip.slipId, OFFICER);
        await esperarPassar(db, c.rodada.cutoffAt);
        const { auditId } = await auditoriaPronta(c.rodada.id);
        await new CalculoService(repo, depoisDaQuinta).calcular(auditId);

        const [confirmou, cancelou] = await Promise.allSettled([
          new SettlementService(repo, depoisDaQuinta).confirmar(auditId, OFFICER),
          cancelamento.cancelar(c.rodada.id, OUTRO, MOTIVO),
        ]);
        expect([confirmou.status, cancelou.status].sort()).toEqual(['fulfilled', 'rejected']);
        const r = await db.betRound.findUniqueOrThrow({ where: { id: c.rodada.id } });
        const a = await db.betAudit.findUniqueOrThrow({ where: { id: auditId } });
        if (cancelou.status === 'fulfilled') {
          expect(a.status).toBe('calculada');
          expect(
            await db.goldLedgerEntry.count({
              where: { roundId: c.rodada.id, kind: { not: 'deposito_validado' } },
            }),
          ).toBe(0);
        } else {
          expect(r.cancelledAt).toBeNull();
          expect(a.status).toBe('confirmada');
        }
      }
    });

    it('cancelar × Calcular: nenhum resultado gravado depois do cancelamento', async () => {
      for (let i = 0; i < 3; i++) {
        const c = await cenario(1, 3_000);
        await esperarPassar(db, c.rodada.cutoffAt);
        const { auditId } = await auditoriaPronta(c.rodada.id);
        await Promise.allSettled([
          new CalculoService(repo, depoisDaQuinta).calcular(auditId),
          cancelamento.cancelar(c.rodada.id, OUTRO, MOTIVO),
        ]);
        const r = await db.betRound.findUniqueOrThrow({ where: { id: c.rodada.id } });
        const a = await db.betAudit.findUniqueOrThrow({ where: { id: auditId } });
        expect(r.cancelledAt).not.toBeNull();
        if (a.status === 'calculada') {
          expect(a.calculatedAt!.getTime()).toBeLessThanOrEqual(r.cancelledAt!.getTime());
        } else {
          expect(await db.betMarketResult.count({ where: { auditId } })).toBe(0);
        }
      }
    });
  });

  describe('T-X12 — o histórico continua legível', () => {
    it('rodada, slip do dono, "ver slip", resultados calculados, saldos e lançamentos', async () => {
      const c = await cenario(1, 3_000);
      const slip = await apostas.salvar(c.rodada.id, c.membros[0]!.conta, c.aposta());
      await apostas.submeter(c.rodada.id, c.membros[0]!.conta, depositante(c.membros[0]!.pj));
      await deposito.confirmar(slip.slipId, OFFICER);
      await esperarPassar(db, c.rodada.cutoffAt);
      const { auditId } = await auditoriaPronta(c.rodada.id);
      const calculo = new CalculoService(repo, depoisDaQuinta);
      await calculo.calcular(auditId);
      await cancelamento.cancelar(c.rodada.id, OFFICER, MOTIVO);

      const membro = c.membros[0]!.conta;
      expect(
        (await rodadas.visiveis(membro.userId, true)).rodadas.find(
          (r) => r.roundId === c.rodada.id,
        ),
      ).toMatchObject({ fase: 'CANCELLED' });
      expect(await rodadas.daRodada(c.rodada.id, membro.userId)).toMatchObject({
        fase: 'CANCELLED',
        podeApostar: false,
      });
      expect(await apostas.meuSlip(c.rodada.id, membro.userId)).toMatchObject({
        status: 'cancelado',
      });
      expect(await deposito.verSlip(slip.slipId, OFFICER)).toMatchObject({ status: 'cancelado' });
      expect((await calculo.resultados(auditId))?.mercados).toHaveLength(1);
      expect((await ledger.saldos(c.rodada.id)).saldos).toHaveLength(1);
      expect((await ledger.lancamentos(slip.slipId)).lancamentos.map((l) => l.kind)).toEqual([
        'deposito_validado',
      ]);
    });
  });
});
