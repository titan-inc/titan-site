import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthService } from '../auth/auth.service';
import { OfficerGuard, RosterGuard } from '../auth/session.guard';
import { ApostaRecusada, ApostasService, ContaNaoElegivel } from './apostas.service';
import { AuditoriaRecusada, AuditoriaService } from './auditoria.service';
import { CalculoService } from './calculo.service';
import { ClosingRecusado, ClosingService } from './closing.service';
import { TitanBetResultsController } from './titan-bet-results.controller';
import { LedgerRecusado, LedgerService, SettlementService } from './settlement.service';
import { DepositoRecusado, DepositoService } from './deposito.service';
import { OddsService } from './odds.service';
import { PreparacaoRecusada, PreparacaoService } from './preparacao.service';
import { ReadyRecusado, ReadyService } from './ready.service';
import { TitanBetMemberController } from './titan-bet-member.controller';
import { TitanBetOfficerController } from './titan-bet-officer.controller';

/**
 * Milestone "RED/GREEN Autorização" (titan-bet-test-design.md §3.9, §7).
 *
 * A pergunta da Regra 5 — "chamado sem cookie devolve 401?" — só se responde
 * por HTTP, com o guard no caminho. Os services são falsos de propósito: o que
 * está sob teste é quem chega até eles.
 */

type Verbo = 'get' | 'post' | 'put';

const OFFICER_ROTAS: Array<[Verbo, string, object?]> = [
  ['post', '/internal/titan-bet/officer/rodadas/r1/ready'],
  ['get', '/internal/titan-bet/officer/rodadas/r1/depositos'],
  ['post', '/internal/titan-bet/officer/slips/s1/confirmar'],
  ['post', '/internal/titan-bet/officer/slips/s1/recusar', { motivo: 'valor diferente' }],
  ['post', '/internal/titan-bet/officer/rodadas'],
  ['get', '/internal/titan-bet/officer/catalogo'],
  ['get', '/internal/titan-bet/officer/rodadas/r1/preparacao'],
  ['put', '/internal/titan-bet/officer/rodadas/r1/preparacao', { weekly: false, encounters: [] }],
  ['post', '/internal/titan-bet/officer/rodadas/r1/auditar'],
  ['post', '/internal/titan-bet/officer/auditorias/a1/calcular'],
  ['get', '/internal/titan-bet/officer/auditorias/a1/resultados'],
  ['post', '/internal/titan-bet/officer/auditorias/a1/confirmar'],
  ['get', '/internal/titan-bet/officer/rodadas/r1/saldos'],
  ['post', '/internal/titan-bet/officer/slips/s1/pagar'],
  ['post', '/internal/titan-bet/officer/rodadas/r1/closing'],
  [
    'post',
    '/internal/titan-bet/officer/slips/s1/ajustes',
    { amount: 100, reason: 'kill conferida', correctsEntryId: '7' },
  ],
  ['get', '/internal/titan-bet/officer/rodadas/r1/auditoria'],
  [
    'post',
    '/internal/titan-bet/officer/auditorias/a1/fontes/terca/sem-raid',
    { motivo: 'raid cancelada' },
  ],
];

const MEMBRO_ROTAS: Array<[Verbo, string, object?]> = [
  ['get', '/internal/titan-bet/rodadas/r1/slip'],
  ['get', '/internal/titan-bet/rodadas/r1/odds'],
  ['get', '/internal/titan-bet/rodadas/r1/closing'],
  ['put', '/internal/titan-bet/rodadas/r1/slip', { apostas: [] }],
  [
    'post',
    '/internal/titan-bet/rodadas/r1/slip/submeter',
    { depositCharacter: { name: 'Qualquer', realm: 'Azralon' } },
  ],
];

const SESSAO = {
  semRoster: { membership: 'not-member', hasInternalAccess: false, isOfficer: false },
  social: { membership: 'member', guildRank: 7, hasInternalAccess: false, isOfficer: false },
  raider: { membership: 'member', guildRank: 4, hasInternalAccess: true, isOfficer: false },
  officer: { membership: 'member', guildRank: 1, hasInternalAccess: true, isOfficer: true },
};

describe('Titan Bet — autorização das rotas', () => {
  let app: NestExpressApplication;
  let server: Server;
  const auth = { resolveSession: jest.fn(), toSessionUser: jest.fn() };
  const ready = { ready: jest.fn() };
  const apostas = { meuSlip: jest.fn(), salvar: jest.fn(), submeter: jest.fn() };
  const odds = { daRodada: jest.fn() };
  const auditoria = { auditar: jest.fn(), corrente: jest.fn(), declararSemRaid: jest.fn() };
  const preparacao = { criar: jest.fn(), catalogo: jest.fn(), ver: jest.fn(), salvar: jest.fn() };
  const calculo = { calcular: jest.fn(), resultados: jest.fn() };
  const settlement = { confirmar: jest.fn() };
  const closing = { publicar: jest.fn(), ultimo: jest.fn() };
  const ledger = { saldos: jest.fn(), pagar: jest.fn(), ajustar: jest.fn() };
  const deposito = {
    pendentes: jest.fn(),
    confirmar: jest.fn(),
    recusar: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TitanBetMemberController, TitanBetOfficerController, TitanBetResultsController],
      providers: [
        RosterGuard,
        OfficerGuard,
        { provide: AuthService, useValue: auth },
        { provide: ReadyService, useValue: ready },
        { provide: ApostasService, useValue: apostas },
        { provide: DepositoService, useValue: deposito },
        { provide: OddsService, useValue: odds },
        { provide: AuditoriaService, useValue: auditoria },
        { provide: PreparacaoService, useValue: preparacao },
        { provide: CalculoService, useValue: calculo },
        { provide: SettlementService, useValue: settlement },
        { provide: LedgerService, useValue: ledger },
        { provide: ClosingService, useValue: closing },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    ready.ready.mockResolvedValue(undefined);
    apostas.meuSlip.mockResolvedValue({
      slipId: 's1',
      status: 'rascunho',
      apostas: [],
      depositCharacter: null,
      expectedTotal: null,
      rejectionReason: null,
    });
    apostas.salvar.mockResolvedValue({ slipId: 's1' });
    apostas.submeter.mockResolvedValue({ total: 300 });
    deposito.pendentes.mockResolvedValue({ depositos: [] });
    odds.daRodada.mockResolvedValue({ roundId: 'r1', mercados: [] });
    auditoria.auditar.mockResolvedValue({ auditId: 'a1' });
    auditoria.corrente.mockResolvedValue(null);
    auditoria.declararSemRaid.mockResolvedValue(undefined);
    preparacao.criar.mockResolvedValue({ roundId: 'r1' });
    preparacao.catalogo.mockResolvedValue({ zonas: [] });
    preparacao.ver.mockResolvedValue(null);
    preparacao.salvar.mockResolvedValue({ roundId: 'r1' });
    calculo.calcular.mockResolvedValue(undefined);
    settlement.confirmar.mockResolvedValue(undefined);
    ledger.saldos.mockResolvedValue({ saldos: [] });
    ledger.pagar.mockResolvedValue(undefined);
    ledger.ajustar.mockResolvedValue(undefined);
    closing.publicar.mockResolvedValue({ version: 1 });
    closing.ultimo.mockResolvedValue({ version: 1, publishedAt: '2026-09-25T00:00:00.000Z' });
    calculo.resultados.mockResolvedValue({ auditId: 'a1', status: 'calculada', mercados: [] });
    deposito.confirmar.mockResolvedValue(undefined);
    deposito.recusar.mockResolvedValue(undefined);
  });

  function comSessao(sessao: keyof typeof SESSAO) {
    auth.resolveSession.mockResolvedValue({ id: 'u1', battletag: 'Conta#1234' });
    auth.toSessionUser.mockResolvedValue(SESSAO[sessao]);
  }

  function chamar([verbo, rota, corpo]: [Verbo, string, object?]) {
    const r = request(server)[verbo](rota);
    return corpo ? r.send(corpo) : r;
  }

  function nenhumServiceChamado() {
    for (const fake of [
      ready,
      apostas,
      deposito,
      odds,
      auditoria,
      preparacao,
      calculo,
      settlement,
      ledger,
      closing,
    ]) {
      for (const fn of Object.values(fake)) expect(fn).not.toHaveBeenCalled();
    }
  }

  describe('T-Z01 — nenhuma rota do Officer Panel aceita quem não é officer', () => {
    it.each(OFFICER_ROTAS)('%s %s sem cookie → 401', async (...rota) => {
      auth.resolveSession.mockResolvedValue(null);
      await chamar(rota).expect(401);
      nenhumServiceChamado();
    });

    it.each(OFFICER_ROTAS)('%s %s como raider (membro sem officer) → 403', async (...rota) => {
      comSessao('raider');
      await chamar(rota).expect(403);
      nenhumServiceChamado();
    });

    it.each(OFFICER_ROTAS)('%s %s como social → 403', async (...rota) => {
      comSessao('social');
      await chamar(rota).expect(403);
      nenhumServiceChamado();
    });
  });

  describe('T-R02 — só officer executa Ready (D-31)', () => {
    it('membro recebe 403 e o Ready não é chamado; sem cookie, 401', async () => {
      comSessao('raider');
      await request(server).post('/internal/titan-bet/officer/rodadas/r1/ready').expect(403);
      auth.resolveSession.mockResolvedValue(null);
      await request(server).post('/internal/titan-bet/officer/rodadas/r1/ready').expect(401);
      expect(ready.ready).not.toHaveBeenCalled();
    });
  });

  describe('T-D05 — membro não confirma nem recusa depósito (D-36)', () => {
    it('confirmar e recusar como membro → 403, sem tocar no depósito', async () => {
      comSessao('raider');
      await request(server).post('/internal/titan-bet/officer/slips/s1/confirmar').expect(403);
      await request(server)
        .post('/internal/titan-bet/officer/slips/s1/recusar')
        .send({ motivo: 'x' })
        .expect(403);
      expect(deposito.confirmar).not.toHaveBeenCalled();
      expect(deposito.recusar).not.toHaveBeenCalled();
    });
  });

  describe('T-Z07 — officer acessa as operações do Officer Panel', () => {
    it('Ready, depósitos pendentes, confirmar e recusar respondem 2xx, com o officer da sessão', async () => {
      comSessao('officer');
      const officer = { userId: 'u1', battletag: 'Conta#1234' };

      await request(server).post('/internal/titan-bet/officer/rodadas/r1/ready').expect(204);
      expect(ready.ready).toHaveBeenCalledWith('r1', officer);

      const pendentes = await request(server)
        .get('/internal/titan-bet/officer/rodadas/r1/depositos')
        .expect(200);
      expect(pendentes.body).toEqual({ depositos: [] });
      expect(deposito.pendentes).toHaveBeenCalledWith('r1');

      await request(server).post('/internal/titan-bet/officer/slips/s1/confirmar').expect(204);
      expect(deposito.confirmar).toHaveBeenCalledWith('s1', officer);

      await request(server)
        .post('/internal/titan-bet/officer/slips/s1/recusar')
        .send({ motivo: 'valor diferente' })
        .expect(204);
      expect(deposito.recusar).toHaveBeenCalledWith('s1', officer, 'valor diferente');
    });

    // Mudança de produto (D-63, D-60): "escolher fonte" deu lugar a "declarar sem raid".
    it('Auditar, ver a auditoria e declarar sem raid, com o officer da sessão (D-30, D-60)', async () => {
      comSessao('officer');
      const officer = { userId: 'u1', battletag: 'Conta#1234' };

      const criada = await request(server)
        .post('/internal/titan-bet/officer/rodadas/r1/auditar')
        .expect(201);
      expect(criada.body).toEqual({ auditId: 'a1' });
      expect(auditoria.auditar).toHaveBeenCalledWith('r1', officer);

      await request(server).get('/internal/titan-bet/officer/rodadas/r1/auditoria').expect(404);
      expect(auditoria.corrente).toHaveBeenCalledWith('r1');

      await request(server)
        .post('/internal/titan-bet/officer/auditorias/a1/fontes/quinta/sem-raid')
        .send({ motivo: 'raid cancelada' })
        .expect(204);
      expect(auditoria.declararSemRaid).toHaveBeenCalledWith(
        'a1',
        'quinta',
        'raid cancelada',
        officer,
      );
    });

    it('sessão fora de terça/quinta e sem raid sem motivo são 400 antes do service', async () => {
      comSessao('officer');
      await request(server)
        .post('/internal/titan-bet/officer/auditorias/a1/fontes/quarta/sem-raid')
        .send({ motivo: 'x' })
        .expect(400);
      await request(server)
        .post('/internal/titan-bet/officer/auditorias/a1/fontes/terca/sem-raid')
        .send({})
        .expect(400);
      expect(auditoria.declararSemRaid).not.toHaveBeenCalled();
    });

    it('calcular e ver os resultados da auditoria (§7.3)', async () => {
      comSessao('officer');
      await request(server).post('/internal/titan-bet/officer/auditorias/a1/calcular').expect(204);
      expect(calculo.calcular).toHaveBeenCalledWith('a1');

      const r = await request(server)
        .get('/internal/titan-bet/officer/auditorias/a1/resultados')
        .expect(200);
      expect(r.body).toEqual({ auditId: 'a1', status: 'calculada', mercados: [] });

      calculo.calcular.mockRejectedValue(new AuditoriaRecusada('depende da OQ-47'));
      await request(server).post('/internal/titan-bet/officer/auditorias/a1/calcular').expect(409);

      calculo.resultados.mockResolvedValue(null);
      await request(server).get('/internal/titan-bet/officer/auditorias/a1/resultados').expect(404);
    });

    it('confirmar, ver saldos, pagar e ajustar, com o officer da sessão (§16.6)', async () => {
      comSessao('officer');
      const officer = { userId: 'u1', battletag: 'Conta#1234' };

      await request(server).post('/internal/titan-bet/officer/auditorias/a1/confirmar').expect(204);
      expect(settlement.confirmar).toHaveBeenCalledWith('a1', officer);

      await request(server).get('/internal/titan-bet/officer/rodadas/r1/saldos').expect(200);
      expect(ledger.saldos).toHaveBeenCalledWith('r1');

      await request(server).post('/internal/titan-bet/officer/slips/s1/pagar').expect(204);
      expect(ledger.pagar).toHaveBeenCalledWith('s1', officer);

      await request(server)
        .post('/internal/titan-bet/officer/slips/s1/ajustes')
        .send({ amount: -20, reason: 'prêmio a mais', correctsEntryId: '7' })
        .expect(204);
      expect(ledger.ajustar).toHaveBeenCalledWith(
        { slipId: 's1', amount: -20, reason: 'prêmio a mais', correctsEntryId: 7n },
        officer,
      );

      ledger.pagar.mockRejectedValue(new LedgerRecusado('não há saldo'));
      await request(server).post('/internal/titan-bet/officer/slips/s1/pagar').expect(409);
      await request(server)
        .post('/internal/titan-bet/officer/slips/s1/ajustes')
        .send({ amount: 0, reason: 'x', correctsEntryId: '7' })
        .expect(400);
    });

    it('publicar o Closing Report, com o officer da sessão (§16.7)', async () => {
      comSessao('officer');
      const r = await request(server)
        .post('/internal/titan-bet/officer/rodadas/r1/closing')
        .expect(201);
      expect(r.body).toEqual({ version: 1 });
      expect(closing.publicar).toHaveBeenCalledWith('r1', {
        userId: 'u1',
        battletag: 'Conta#1234',
      });

      closing.publicar.mockRejectedValue(new ClosingRecusado('sem auditoria confirmada'));
      await request(server).post('/internal/titan-bet/officer/rodadas/r1/closing').expect(409);
    });

    it('Auditar recusado é 409, com o motivo', async () => {
      comSessao('officer');
      auditoria.auditar.mockRejectedValue(new AuditoriaRecusada('o cutoff não passou'));
      const r = await request(server)
        .post('/internal/titan-bet/officer/rodadas/r1/auditar')
        .expect(409);
      expect(JSON.stringify(r.body)).toContain('o cutoff não passou');
    });

    it('T-G11 — criar, ver o catálogo, ver e salvar a preparação, com o officer da sessão', async () => {
      comSessao('officer');
      const officer = { userId: 'u1', battletag: 'Conta#1234' };

      const criada = await request(server).post('/internal/titan-bet/officer/rodadas').expect(201);
      expect(criada.body).toEqual({ roundId: 'r1' });
      expect(preparacao.criar).toHaveBeenCalledWith(officer);

      await request(server).get('/internal/titan-bet/officer/catalogo').expect(200);
      await request(server).get('/internal/titan-bet/officer/rodadas/r1/preparacao').expect(404);
      expect(preparacao.ver).toHaveBeenCalledWith('r1');

      const corpo = {
        weekly: false,
        encounters: [{ encounterId: 7, track: 'farm', mercados: ['top_dps'] }],
      };
      await request(server)
        .put('/internal/titan-bet/officer/rodadas/r1/preparacao')
        .send(corpo)
        .expect(200);
      expect(preparacao.salvar).toHaveBeenCalledWith('r1', corpo, officer);
    });

    it('preparação fora do contrato é 400; recusada pelo estado da rodada é 409', async () => {
      comSessao('officer');
      await request(server)
        .put('/internal/titan-bet/officer/rodadas/r1/preparacao')
        .send({ weekly: false, encounters: [], candidatos: ['c1'] })
        .expect(400);
      expect(preparacao.salvar).not.toHaveBeenCalled();

      preparacao.criar.mockRejectedValue(new PreparacaoRecusada('já existe'));
      await request(server).post('/internal/titan-bet/officer/rodadas').expect(409);
    });

    it('recusar sem motivo é 400 antes do service (D-34)', async () => {
      comSessao('officer');
      await request(server)
        .post('/internal/titan-bet/officer/slips/s1/recusar')
        .send({ motivo: '  ' })
        .expect(400);
      expect(deposito.recusar).not.toHaveBeenCalled();
    });

    it('recusa de domínio vira 409, não 500', async () => {
      comSessao('officer');
      ready.ready.mockRejectedValue(new ReadyRecusado('a rodada já teve Ready'));
      deposito.confirmar.mockRejectedValue(new DepositoRecusado('o slip está valido'));

      await request(server).post('/internal/titan-bet/officer/rodadas/r1/ready').expect(409);
      await request(server).post('/internal/titan-bet/officer/slips/s1/confirmar').expect(409);
    });
  });

  describe('superfície do membro (D-01, D-36)', () => {
    it.each(MEMBRO_ROTAS)('%s %s sem cookie → 401', async (...rota) => {
      auth.resolveSession.mockResolvedValue(null);
      await chamar(rota).expect(401);
      nenhumServiceChamado();
    });

    it.each(MEMBRO_ROTAS)('%s %s sem personagem no roster → 403', async (...rota) => {
      comSessao('semRoster');
      await chamar(rota).expect(403);
      nenhumServiceChamado();
    });

    it('RosterGuard, não MemberGuard: rank acima do corte da área interna chega ao service', async () => {
      comSessao('social');
      const conta = { userId: 'u1', battletag: 'Conta#1234' };

      await request(server).get('/internal/titan-bet/rodadas/r1/slip').expect(200);
      expect(apostas.meuSlip).toHaveBeenCalledWith('r1', 'u1');

      await request(server)
        .put('/internal/titan-bet/rodadas/r1/slip')
        .send({ apostas: [] })
        .expect(200);
      expect(apostas.salvar).toHaveBeenCalledWith('r1', conta, { apostas: [] });

      await request(server)
        .post('/internal/titan-bet/rodadas/r1/slip/submeter')
        .send({ depositCharacter: { name: 'Qualquer', realm: 'Azralon' } })
        .expect(200);
      expect(apostas.submeter).toHaveBeenCalledWith('r1', conta, {
        depositCharacter: { name: 'Qualquer', realm: 'Azralon' },
      });
    });

    it('T-Z08 — odds pela superfície do membro, com a conta da sessão', async () => {
      comSessao('social');
      const r = await request(server).get('/internal/titan-bet/rodadas/r1/odds').expect(200);
      expect(r.body).toEqual({ roundId: 'r1', mercados: [] });
      expect(odds.daRodada).toHaveBeenCalledWith('r1', 'u1');

      odds.daRodada.mockRejectedValue(new ContaNaoElegivel());
      await request(server).get('/internal/titan-bet/rodadas/r1/odds').expect(403);
    });

    it('o Closing Report publicado é de qualquer membro da guilda (RosterGuard, D-21)', async () => {
      comSessao('social');
      await request(server).get('/internal/titan-bet/rodadas/r1/closing').expect(200);
      expect(closing.ultimo).toHaveBeenCalledWith('r1');

      closing.ultimo.mockResolvedValue(null);
      await request(server).get('/internal/titan-bet/rodadas/r1/closing').expect(404);
    });

    it('corpo fora do contrato é 400 antes do service', async () => {
      comSessao('social');
      await request(server)
        .put('/internal/titan-bet/rodadas/r1/slip')
        .send({ apostas: [{ marketId: 'm1', stake: 200.5, targetCharacterId: 'c1' }] })
        .expect(400);
      await request(server)
        .post('/internal/titan-bet/rodadas/r1/slip/submeter')
        .send({})
        .expect(400);
      expect(apostas.salvar).not.toHaveBeenCalled();
      expect(apostas.submeter).not.toHaveBeenCalled();
    });

    it('T-Z02 — sem slip da própria conta na rodada: 404, sem corpo de slip', async () => {
      comSessao('social');
      apostas.meuSlip.mockResolvedValue(null);
      const r = await request(server).get('/internal/titan-bet/rodadas/r1/slip').expect(404);
      expect(r.body).not.toHaveProperty('slipId');
      expect(r.body).not.toHaveProperty('apostas');
    });

    it('T-Z03 — conta fora do snapshot de bettors: 403 (D-32, D-38)', async () => {
      comSessao('social');
      apostas.salvar.mockRejectedValue(new ContaNaoElegivel());
      await request(server)
        .put('/internal/titan-bet/rodadas/r1/slip')
        .send({ apostas: [] })
        .expect(403);
    });

    it('outra recusa de aposta é 422, com o motivo', async () => {
      comSessao('social');
      apostas.submeter.mockRejectedValue(new ApostaRecusada('o slip não tem nenhuma aposta'));
      const r = await request(server)
        .post('/internal/titan-bet/rodadas/r1/slip/submeter')
        .send({ depositCharacter: { name: 'Qualquer', realm: 'Azralon' } })
        .expect(422);
      expect(JSON.stringify(r.body)).toContain('o slip não tem nenhuma aposta');
    });
  });
});
