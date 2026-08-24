import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthService } from '../auth/auth.service';
import { RosterGuard } from '../auth/session.guard';
import { MplusController } from './mplus.controller';
import { MplusService } from './mplus.service';

const bodyValido = {
  vagas: { tank: 0, healer: 1, dps: 1 },
  quando: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
  keyMin: 12,
  keyMax: 14,
  faltando: ['lust'],
};

/**
 * O teste que a Regra 5 pede: a pergunta não é "a UI esconde?", é "chamado sem
 * cookie devolve 401?". Só se responde por HTTP, com o guard no caminho.
 *
 * O caso mais importante daqui é o do rank: quem está **acima** do corte da
 * área interna tem que conseguir criar vaga. Se um dia alguém trocar o guard
 * por `MemberGuard` "para ficar igual aos outros", este teste quebra — que é o
 * ponto.
 */
describe('/internal/mplus/vagas — autorização', () => {
  let app: NestExpressApplication;
  let server: Server;
  const auth = { resolveSession: jest.fn(), toSessionUser: jest.fn() };
  const mplus = {
    listar: jest.fn().mockResolvedValue({ vagas: [] }),
    obter: jest.fn(),
    criar: jest.fn().mockResolvedValue({ id: 'vaga-1' }),
    apagar: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MplusController],
      providers: [
        RosterGuard,
        { provide: AuthService, useValue: auth },
        { provide: MplusService, useValue: mplus },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    // O guard lê `req.cookies`, que só existe com o parser instalado — igual no
    // `main.ts`. Sem ele o teste passaria por outro motivo que não o certo.
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => app.close());

  beforeEach(() => jest.clearAllMocks());

  it('sem cookie devolve 401 em todos os verbos', async () => {
    auth.resolveSession.mockResolvedValue(null);

    await request(server).get('/internal/mplus/vagas').expect(401);
    await request(server).post('/internal/mplus/vagas').send(bodyValido).expect(401);
    await request(server).delete('/internal/mplus/vagas/vaga-1').expect(401);
    expect(mplus.criar).not.toHaveBeenCalled();
  });

  it('conta sem personagem no roster recebe 403', async () => {
    auth.resolveSession.mockResolvedValue({ id: 'u1' });
    auth.toSessionUser.mockResolvedValue({ membership: 'not-member', hasInternalAccess: false });

    await request(server).post('/internal/mplus/vagas').send(bodyValido).expect(403);
    expect(mplus.criar).not.toHaveBeenCalled();
  });

  it('membro de rank ACIMA do corte da área interna CONSEGUE criar vaga', async () => {
    // Rank 5 (social): não entra na área interna, e mesmo assim anuncia M+.
    // É o estado do meio da Regra 4, e a primeira coisa que ele recebe.
    auth.resolveSession.mockResolvedValue({ id: 'u1', battletag: 'Social#1234' });
    auth.toSessionUser.mockResolvedValue({
      membership: 'member',
      guildRank: 5,
      hasInternalAccess: false,
    });

    await request(server).post('/internal/mplus/vagas').send(bodyValido).expect(201);
    expect(mplus.criar).toHaveBeenCalledWith(expect.anything(), 'u1');

    await request(server).get('/internal/mplus/vagas').expect(200);
    await request(server).delete('/internal/mplus/vagas/vaga-1').expect(204);
  });

  it('recusa body inválido com 400 antes de chegar no service', async () => {
    auth.resolveSession.mockResolvedValue({ id: 'u1', battletag: 'Social#1234' });
    auth.toSessionUser.mockResolvedValue({ membership: 'member', hasInternalAccess: false });

    await request(server)
      .post('/internal/mplus/vagas')
      .send({ ...bodyValido, vagas: { tank: 0, healer: 0, dps: 0 } })
      .expect(400);

    await request(server)
      .post('/internal/mplus/vagas')
      .send({ ...bodyValido, quando: 'amanhã 21h' })
      .expect(400);

    expect(mplus.criar).not.toHaveBeenCalled();
  });
});
