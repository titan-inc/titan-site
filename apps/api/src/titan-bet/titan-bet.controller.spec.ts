import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthService } from '../auth/auth.service';
import { OfficerGuard, RosterGuard } from '../auth/session.guard';
import { ApostaRecusada, ApostasService, ContaNaoElegivel } from './apostas.service';
import { DepositoRecusado, DepositoService } from './deposito.service';
import { OddsService } from './odds.service';
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
];

const MEMBRO_ROTAS: Array<[Verbo, string, object?]> = [
  ['get', '/internal/titan-bet/rodadas/r1/slip'],
  ['get', '/internal/titan-bet/rodadas/r1/odds'],
  ['put', '/internal/titan-bet/rodadas/r1/slip', { apostas: [] }],
  ['post', '/internal/titan-bet/rodadas/r1/slip/submeter', { depositCharacterId: 'c1' }],
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
  const deposito = {
    pendentes: jest.fn(),
    confirmar: jest.fn(),
    recusar: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TitanBetMemberController, TitanBetOfficerController],
      providers: [
        RosterGuard,
        OfficerGuard,
        { provide: AuthService, useValue: auth },
        { provide: ReadyService, useValue: ready },
        { provide: ApostasService, useValue: apostas },
        { provide: DepositoService, useValue: deposito },
        { provide: OddsService, useValue: odds },
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
      depositCharacterId: null,
      expectedTotal: null,
      rejectionReason: null,
    });
    apostas.salvar.mockResolvedValue({ slipId: 's1' });
    apostas.submeter.mockResolvedValue({ total: 300 });
    deposito.pendentes.mockResolvedValue({ depositos: [] });
    odds.daRodada.mockResolvedValue({ roundId: 'r1', mercados: [] });
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
    for (const fake of [ready, apostas, deposito, odds]) {
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
        .send({ depositCharacterId: 'c1' })
        .expect(200);
      expect(apostas.submeter).toHaveBeenCalledWith('r1', conta, { depositCharacterId: 'c1' });
    });

    it('T-Z08 — odds pela superfície do membro, com a conta da sessão', async () => {
      comSessao('social');
      const r = await request(server).get('/internal/titan-bet/rodadas/r1/odds').expect(200);
      expect(r.body).toEqual({ roundId: 'r1', mercados: [] });
      expect(odds.daRodada).toHaveBeenCalledWith('r1', 'u1');

      odds.daRodada.mockRejectedValue(new ContaNaoElegivel());
      await request(server).get('/internal/titan-bet/rodadas/r1/odds').expect(403);
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
        .send({ depositCharacterId: 'c1' })
        .expect(422);
      expect(JSON.stringify(r.body)).toContain('o slip não tem nenhuma aposta');
    });
  });
});
