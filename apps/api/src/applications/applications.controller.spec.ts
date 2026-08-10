import { MODULE_METADATA } from '@nestjs/common/constants';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Server } from 'node:http';
import request from 'supertest';
import { DiscordModule } from '../discord/discord.module';
import { DiscordDeliveryError, DiscordService } from '../discord/discord.service';
import { ApplicationsModule } from './applications.module';

const candidatura = {
  characterRealm: 'Thrall — Azralon',
  roleSpec: 'Tank / Protection Warrior',
  contact: 'Discord: thrall.azeroth',
};

describe('POST /applications', () => {
  let app: NestExpressApplication;
  let server: Server;
  const discord = { send: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60 * 60 * 1_000, limit: 5 }]), ApplicationsModule],
    })
      .overrideProvider(DiscordService)
      .useValue(discord)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', 1);
    await app.init();
    server = app.getHttpServer();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    discord.send.mockResolvedValue(undefined);
  });

  afterAll(async () => app.close());

  it('aceita sem cookie ou autenticação e responde 201', async () => {
    await request(server)
      .post('/applications')
      .set('X-Forwarded-For', '203.0.113.10')
      .send(candidatura)
      .expect(201)
      .expect({ delivered: true });
    expect(discord.send).toHaveBeenCalledTimes(1);
  });

  it('rejeita corpo inválido com o campo nos issues', async () => {
    const response = await request(server)
      .post('/applications')
      .set('X-Forwarded-For', '203.0.113.11')
      .send({ ...candidatura, contact: '' })
      .expect(400);
    const body = response.body as { issues: Array<{ path: string }> };
    expect(body.issues).toContainEqual(expect.objectContaining({ path: 'contact' }));
  });

  it('mapeia falha do Discord para o status público correto', async () => {
    discord.send.mockRejectedValueOnce(new DiscordDeliveryError('upstream', 500));
    await request(server)
      .post('/applications')
      .set('X-Forwarded-For', '203.0.113.12')
      .send(candidatura)
      .expect(502);
  });

  it('limita o sexto envio do mesmo IP', async () => {
    const ip = '203.0.113.200';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server)
        .post('/applications')
        .set('X-Forwarded-For', ip)
        .send(candidatura)
        .expect(201);
    }
    await request(server)
      .post('/applications')
      .set('X-Forwarded-For', ip)
      .send(candidatura)
      .expect(429);
  });

  it('não importa Prisma no módulo', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, ApplicationsModule)).toEqual([
      DiscordModule,
    ]);
  });
});
