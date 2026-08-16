import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { CharactersRepository } from '../characters/characters.repository';
import { LootSessionDummiesService } from './loot-session-dummies.service';
import type { LootSessionsRepository, SessionRow } from './loot-sessions.repository';
import type { LootSessionsService } from './loot-sessions.service';

/** Só os campos que o serviço de fato olha: `id`, `status`, `items`. */
function sessaoFixture(
  status: SessionRow['status'],
  items: Array<{ id: string }> = [{ id: 'item-1' }],
): SessionRow {
  return { id: 'sess-1', status, items } as unknown as SessionRow;
}

type Resposta = Awaited<ReturnType<LootSessionsRepository['findTodasAsRespostas']>>[number];

function montar() {
  const sessions = {
    entrar: jest.fn(() => Promise.resolve({})),
    responder: jest.fn(() => Promise.resolve({})),
  };
  const repo = {
    findById: jest.fn(),
    findOpcoesDoJogador: jest.fn(() => Promise.resolve([{ slug: 'ms', label: 'Main Spec' }])),
    findTodasAsRespostas: jest.fn<Promise<Resposta[]>, [string]>(() => Promise.resolve([])),
  };
  const characters = {
    resolver: jest.fn(() => Promise.resolve('char-id')),
  };

  const service = new LootSessionDummiesService(
    sessions as unknown as LootSessionsService,
    repo as unknown as LootSessionsRepository,
    characters as unknown as CharactersRepository,
  );

  return { service, sessions, repo, characters };
}

describe('LootSessionDummiesService.rodar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('recusa sessão inexistente', async () => {
    const { service, repo } = montar();
    repo.findById.mockResolvedValue(null);

    await expect(service.rodar('sess-1')).rejects.toThrow(NotFoundException);
  });

  it('recusa sessão já encerrada — nada a simular', async () => {
    const { service, repo } = montar();
    repo.findById.mockResolvedValue(sessaoFixture('encerrada'));

    await expect(service.rodar('sess-1')).rejects.toThrow(BadRequestException);
  });

  it('cria e entra com o número padrão de dummies (6), sintéticos e identificáveis', async () => {
    const { service, repo, characters, sessions } = montar();
    repo.findById.mockResolvedValue(sessaoFixture('rascunho'));

    const resultado = await service.rodar('sess-1');

    expect(characters.resolver).toHaveBeenCalledTimes(6);
    expect(sessions.entrar).toHaveBeenCalledTimes(6);
    expect(resultado.dummies).toHaveLength(6);
    expect(resultado.dummies[0]).toEqual({ name: 'Dummy1', realm: 'TestDummy' });
  });

  it('clampa quantidade fora da faixa 2–10', async () => {
    const { service, repo, sessions } = montar();
    repo.findById.mockResolvedValue(sessaoFixture('rascunho'));

    await service.rodar('sess-1', 99);
    expect(sessions.entrar).toHaveBeenCalledTimes(10);

    sessions.entrar.mockClear();
    await service.rodar('sess-2', 0);
    expect(sessions.entrar).toHaveBeenCalledTimes(2);
  });

  it('recusa uma segunda simulação na mesma sessão enquanto a primeira está rodando', async () => {
    const { service, repo } = montar();
    repo.findById.mockResolvedValue(sessaoFixture('aberta'));

    await service.rodar('sess-1');
    await expect(service.rodar('sess-1')).rejects.toThrow(ConflictException);
  });

  it('devolve o kill switch ~10 minutos à frente do início — não da criação da sessão', async () => {
    const { service, repo } = montar();
    repo.findById.mockResolvedValue(sessaoFixture('rascunho'));

    const antes = Date.now();
    const resultado = await service.rodar('sess-1');
    const killSwitchMs = new Date(resultado.killSwitchAt).getTime();

    expect(killSwitchMs - antes).toBeGreaterThanOrEqual(10 * 60 * 1000 - 100);
    expect(killSwitchMs - antes).toBeLessThanOrEqual(10 * 60 * 1000 + 100);
  });
});

describe('LootSessionDummiesService — ciclo de 2 em 2 segundos', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('em aberta, responde 1 ou 2 vezes por ciclo — nunca zero, nunca uma quantidade enorme', async () => {
    const { service, repo, sessions } = montar();
    repo.findById.mockResolvedValue(sessaoFixture('rascunho'));
    await service.rodar('sess-1');

    repo.findById.mockResolvedValue(sessaoFixture('aberta', [{ id: 'item-1' }, { id: 'item-2' }]));
    sessions.responder.mockClear();

    await jest.advanceTimersByTimeAsync(2_000);

    expect(sessions.responder.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(sessions.responder.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('em deliberando, só responde a quem o loot master reabriu — os outros ficam ocioso', async () => {
    const { service, repo, sessions } = montar();
    repo.findById.mockResolvedValue(sessaoFixture('rascunho'));
    await service.rodar('sess-1');

    repo.findById.mockResolvedValue(sessaoFixture('deliberando'));
    repo.findTodasAsRespostas.mockResolvedValue([
      {
        itemId: 'item-1',
        nameKey: 'dummy1',
        realmKey: 'testdummy',
        name: 'Dummy1',
        realm: 'TestDummy',
        responseOptionSlug: 'ms',
        roll: 50,
        note: null,
        aguardandoNovaResposta: true,
      },
      {
        itemId: 'item-2',
        nameKey: 'dummy2',
        realmKey: 'testdummy',
        name: 'Dummy2',
        realm: 'TestDummy',
        responseOptionSlug: 'ms',
        roll: 40,
        note: null,
        aguardandoNovaResposta: false,
      },
    ]);
    sessions.responder.mockClear();

    await jest.advanceTimersByTimeAsync(2_000);

    expect(sessions.responder).toHaveBeenCalledTimes(1);
    expect(sessions.responder).toHaveBeenCalledWith(
      'sess-1',
      'item-1',
      expect.objectContaining({ responseOptionSlug: 'ms' }),
      { userId: 'dummy-1', battletag: 'Dummy1#TEST' },
    );
  });

  it('em deliberando sem ninguém reaberto, o ciclo não faz nada', async () => {
    const { service, repo, sessions } = montar();
    repo.findById.mockResolvedValue(sessaoFixture('rascunho'));
    await service.rodar('sess-1');

    repo.findById.mockResolvedValue(sessaoFixture('deliberando'));
    repo.findTodasAsRespostas.mockResolvedValue([]);
    sessions.responder.mockClear();

    await jest.advanceTimersByTimeAsync(2_000);

    expect(sessions.responder).not.toHaveBeenCalled();
  });

  it('para sozinha, para sempre, assim que a sessão encerra', async () => {
    const { service, repo } = montar();
    repo.findById.mockResolvedValue(sessaoFixture('rascunho'));
    await service.rodar('sess-1');

    repo.findById.mockResolvedValue(sessaoFixture('encerrada'));
    repo.findById.mockClear();
    await jest.advanceTimersByTimeAsync(2_000); // um tick vê 'encerrada' e para

    repo.findById.mockClear();
    await jest.advanceTimersByTimeAsync(10_000); // vários ciclos depois: nenhum tick a mais
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('o kill switch de 10min para a simulação mesmo com a sessão continuando aberta', async () => {
    const { service, repo } = montar();
    repo.findById.mockResolvedValue(sessaoFixture('rascunho'));
    await service.rodar('sess-1');

    repo.findById.mockResolvedValue(sessaoFixture('aberta'));

    await jest.advanceTimersByTimeAsync(10 * 60 * 1_000 + 2_000);

    repo.findById.mockClear();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('depois que uma simulação para (sessão encerrada), a MESMA sessão pode rodar de novo', async () => {
    const { service, repo } = montar();
    repo.findById.mockResolvedValue(sessaoFixture('rascunho'));
    await service.rodar('sess-1');

    repo.findById.mockResolvedValue(sessaoFixture('encerrada'));
    await jest.advanceTimersByTimeAsync(2_000); // a simulação anterior para

    repo.findById.mockResolvedValue(sessaoFixture('rascunho'));
    await expect(service.rodar('sess-1')).resolves.toBeDefined();
  });
});
