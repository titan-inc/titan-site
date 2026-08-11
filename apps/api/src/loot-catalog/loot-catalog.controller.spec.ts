import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { RAID_DIFFICULTIES } from '@titan/shared';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthService } from '../auth/auth.service';
import { MemberGuard } from '../auth/session.guard';
import { LootCatalogController } from './loot-catalog.controller';
import { LootCatalogService } from './loot-catalog.service';

/** Chama o método do controller direto, sem subir `TestingModule` — padrão da api. */
function montar() {
  const service = {
    listRaidSummaries: jest.fn().mockResolvedValue([]),
    getRaid: jest.fn().mockResolvedValue({ slug: 'the-voidspire' }),
  };

  return {
    controller: new LootCatalogController(service as unknown as LootCatalogService),
    service,
  };
}

describe('LootCatalogController', () => {
  describe('lista de raids', () => {
    it('sem filtro pede todas', async () => {
      const { controller, service } = montar();

      await controller.listRaids();

      // `{}` e não `{ seasonId: undefined }`: o repositório testa `'seasonId' in
      // filtro`, então a chave presente com undefined viraria "as sem season".
      expect(service.listRaidSummaries).toHaveBeenCalledWith({});
    });

    it('filtra por season quando pedido', async () => {
      const { controller, service } = montar();

      await controller.listRaids('18');

      expect(service.listRaidSummaries).toHaveBeenCalledWith({ seasonId: 18 });
    });

    it('recusa season que não é inteiro positivo', async () => {
      const { controller, service } = montar();

      await expect(controller.listRaids('abc')).rejects.toThrow(BadRequestException);
      await expect(controller.listRaids('-1')).rejects.toThrow(BadRequestException);
      expect(service.listRaidSummaries).not.toHaveBeenCalled();
    });

    it('trata string vazia como ausente', async () => {
      // `?season=` é o que um form manda quando o campo não foi preenchido.
      const { controller, service } = montar();

      await controller.listRaids('');

      expect(service.listRaidSummaries).toHaveBeenCalledWith({});
    });
  });

  describe('raid pelo slug', () => {
    it('repassa a dificuldade validada', async () => {
      const { controller, service } = montar();

      await controller.getRaid('the-voidspire', 'mythic');

      expect(service.getRaid).toHaveBeenCalledWith('the-voidspire', RAID_DIFFICULTIES.MYTHIC);
    });

    it('sem dificuldade pede tudo', async () => {
      const { controller, service } = montar();

      await controller.getRaid('the-voidspire');

      expect(service.getRaid).toHaveBeenCalledWith('the-voidspire', undefined);
    });

    it('recusa dificuldade fora do vocabulário, dizendo os aceitos', async () => {
      // Sem isto a string cairia no `where` do Prisma como enum inválido e viraria
      // 500 sem explicar nada.
      const { controller, service } = montar();

      await expect(controller.getRaid('the-voidspire', 'mitico')).rejects.toThrow(
        /normal, heroic, mythic/,
      );
      expect(service.getRaid).not.toHaveBeenCalled();
    });

    it('404 quando a raid não está cadastrada', async () => {
      // E não lista vazia: `[]` faria raid inexistente parecer raid sem loot.
      const { controller, service } = montar();
      service.getRaid.mockResolvedValue(null);

      await expect(controller.getRaid('nao-existe')).rejects.toThrow(NotFoundException);
    });
  });
});

/**
 * O teste que a Regra 5 pede, e que os de cima NÃO fazem.
 *
 * Chamar o método do controller direto passa por cima do guard — é o que faz
 * aqueles testes serem rápidos, e é exatamente por isso que eles não provam nada
 * sobre autorização. A Regra 5 diz que o teste não é "a UI esconde?", é "chamado
 * sem cookie devolve 401?", e isso só se responde por HTTP.
 */
describe('GET /internal/loot-catalog sem sessão', () => {
  let app: NestExpressApplication;
  let server: Server;
  const auth = { resolveSession: jest.fn(), toSessionUser: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LootCatalogController],
      providers: [
        MemberGuard,
        { provide: AuthService, useValue: auth },
        {
          provide: LootCatalogService,
          useValue: { listRaidSummaries: jest.fn(), getRaid: jest.fn() },
        },
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

  it('recusa a lista com 401', async () => {
    auth.resolveSession.mockResolvedValue(null);

    await request(server).get('/internal/loot-catalog').expect(401);
  });

  it('recusa a raid com 401', async () => {
    auth.resolveSession.mockResolvedValue(null);

    await request(server).get('/internal/loot-catalog/the-voidspire').expect(401);
  });

  it('recusa com 403 quem tem sessão mas não alcança o corte de rank', async () => {
    // Distinção que importa: 401 é "quem é você", 403 é "sei quem é e não pode".
    auth.resolveSession.mockResolvedValue({ id: 'u1' });
    auth.toSessionUser.mockResolvedValue({ hasInternalAccess: false, membership: 'member' });

    await request(server).get('/internal/loot-catalog').expect(403);
  });
});
