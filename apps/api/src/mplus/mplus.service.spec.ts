import { BadGatewayException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VAGA_EXPURGO_DIAS, type CriarVaga } from '@titan/shared';
import { DiscordDeliveryError, type DiscordService } from '../discord/discord.service';
import type { MplusRepository, VagaComAutor } from './mplus.repository';
import { MplusService } from './mplus.service';

const DONO = 'conta-do-dono';
const OUTRO = 'conta-de-outra-pessoa';

const dto: CriarVaga = {
  vagas: { tank: 0, healer: 1, dps: 1 },
  quando: '2026-08-13T00:00:00.000Z',
  keyMin: 12,
  keyMax: 14,
  faltando: ['lust'],
  observacao: 'Fecha o dever de casa.',
};

function linha(overrides: Partial<VagaComAutor> = {}): VagaComAutor {
  return {
    id: 'vaga-1',
    userId: DONO,
    tank: 0,
    healer: 1,
    dps: 1,
    quando: new Date(dto.quando),
    keyMin: 12,
    keyMax: 14,
    semLust: true,
    semBrez: false,
    observacao: 'Fecha o dever de casa.',
    entregue: false,
    createdAt: new Date('2026-08-12T15:00:00.000Z'),
    user: { battletag: 'Fulano#1234' },
    ...overrides,
  };
}

describe('MplusService', () => {
  const repo = {
    criar: jest.fn(),
    marcarEntregue: jest.fn(),
    listar: jest.fn(),
    findById: jest.fn(),
    apagar: jest.fn(),
    apagarCriadasAntesDe: jest.fn(),
  };
  const discord = { send: jest.fn(), mplusRoleId: undefined as string | undefined };
  let service: MplusService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GUILD_NAME = 'Titan Inc';
    process.env.GUILD_REALM = 'Azralon';
    repo.criar.mockResolvedValue(linha());
    repo.marcarEntregue.mockResolvedValue(undefined);
    discord.send.mockResolvedValue(undefined);
    service = new MplusService(
      repo as unknown as MplusRepository,
      discord as unknown as DiscordService,
    );
  });

  it('grava a vaga ANTES de entregar, e só então marca como entregue', async () => {
    const ordem: string[] = [];
    repo.criar.mockImplementation(() => {
      ordem.push('gravou');
      return Promise.resolve(linha());
    });
    discord.send.mockImplementation(() => {
      ordem.push('entregou');
      return Promise.resolve(undefined);
    });
    repo.marcarEntregue.mockImplementation(() => {
      ordem.push('marcou');
      return Promise.resolve(undefined);
    });

    const vaga = await service.criar(dto, DONO);

    expect(ordem).toEqual(['gravou', 'entregou', 'marcou']);
    expect(vaga.entregue).toBe(true);
  });

  it('entrega no canal de M+, e em nenhum outro', async () => {
    await service.criar(dto, DONO);

    expect(discord.send).toHaveBeenCalledTimes(1);
    expect(discord.send).toHaveBeenCalledWith('mplus', expect.anything());
  });

  it('falha de entrega deixa a vaga gravada e NÃO entregue', async () => {
    discord.send.mockRejectedValue(new DiscordDeliveryError('upstream', 500));

    await expect(service.criar(dto, DONO)).rejects.toBeInstanceOf(BadGatewayException);

    // A linha existe (foi criada), e ninguém marcou entrega que não houve.
    expect(repo.criar).toHaveBeenCalledTimes(1);
    expect(repo.marcarEntregue).not.toHaveBeenCalled();
  });

  it('traduz faltando[] para as colunas do banco', async () => {
    await service.criar({ ...dto, faltando: ['brez'] }, DONO);
    expect(repo.criar).toHaveBeenCalledWith(
      expect.objectContaining({ semLust: false, semBrez: true, userId: DONO }),
    );
  });

  describe('apagar', () => {
    it('deixa quem criou apagar', async () => {
      repo.findById.mockResolvedValue(linha());
      await expect(service.apagar('vaga-1', DONO)).resolves.toBeUndefined();
      expect(repo.apagar).toHaveBeenCalledWith('vaga-1');
    });

    it('recusa quem NÃO criou', async () => {
      repo.findById.mockResolvedValue(linha());
      await expect(service.apagar('vaga-1', OUTRO)).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.apagar).not.toHaveBeenCalled();
    });

    it('404 quando a vaga já sumiu', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.apagar('vaga-1', DONO)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('marca podeApagar só para quem criou', async () => {
    repo.listar.mockResolvedValue([linha()]);

    expect((await service.listar(DONO)).vagas[0]?.podeApagar).toBe(true);
    expect((await service.listar(OUTRO)).vagas[0]?.podeApagar).toBe(false);
  });

  it('expurga o que passou de 7 dias de criação', async () => {
    repo.apagarCriadasAntesDe.mockResolvedValue(3);
    const agora = new Date('2026-08-20T04:00:00.000Z');

    await expect(service.expurgar(agora)).resolves.toBe(3);

    const chamadas = repo.apagarCriadasAntesDe.mock.calls as Array<[Date]>;
    const limite = chamadas[0]![0];
    expect(agora.getTime() - limite.getTime()).toBe(VAGA_EXPURGO_DIAS * 24 * 60 * 60 * 1_000);
  });

  it('o cron não deixa falha de faxina derrubar o processo', async () => {
    repo.apagarCriadasAntesDe.mockRejectedValue(new Error('banco fora'));
    await expect(service.expurgoScheduled()).resolves.toBeUndefined();
  });
});
