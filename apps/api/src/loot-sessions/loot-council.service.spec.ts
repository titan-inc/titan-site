import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LootCouncilService } from './loot-council.service';
import type { Ator, LootSessionsRepository, SessionRow } from './loot-sessions.repository';

const ATOR: Ator = { userId: 'conselheiro-1', battletag: 'Conselho#0001' };
const OUTRO: Ator = { userId: 'conselheiro-2', battletag: 'Conselho#0002' };

const sessao = (over: Partial<SessionRow> = {}): SessionRow =>
  ({
    id: 'sess-1',
    status: 'deliberando',
    createdByBattletag: 'Loot#0001',
    items: [
      { id: 'item-1', position: 1, itemId: 202612 },
      { id: 'item-2', position: 2, itemId: 202593 },
    ],
    ...over,
  }) as unknown as SessionRow;

/** Respostas como o repositório devolve. Nomes fictícios — o repo é público. */
const resposta = (over: Record<string, unknown> = {}) => ({
  itemId: 'item-1',
  nameKey: 'fulano',
  realmKey: 'azralon',
  name: 'Fulano',
  realm: 'Azralon',
  responseOptionSlug: 'bis',
  roll: 40,
  aguardandoNovaResposta: false,
  ...over,
});

describe('LootCouncilService', () => {
  const repo = {
    findById: jest.fn<Promise<SessionRow | null>, [string]>(() => Promise.resolve(sessao())),
    findTodasAsRespostas: jest.fn<Promise<ReturnType<typeof resposta>[]>, [string]>(() =>
      Promise.resolve([resposta()]),
    ),
    findVotos: jest.fn<
      Promise<
        Array<{
          itemId: string;
          candidateNameKey: string;
          candidateRealmKey: string;
          voterUserId: string;
        }>
      >,
      [string]
    >(() => Promise.resolve([])),
    votar: jest.fn<Promise<void>, [unknown]>(() => Promise.resolve()),
    reabrirResposta: jest.fn<Promise<boolean>, [unknown]>(() => Promise.resolve(true)),
    alterarResposta: jest.fn<Promise<boolean>, [unknown]>(() => Promise.resolve(true)),
    itemPertence: jest.fn<Promise<boolean>, [string, string]>(() => Promise.resolve(true)),
    findSlugsAtivos: jest.fn<Promise<string[]>, []>(() => Promise.resolve(['bis', 'upgrade'])),
  };

  let service: LootCouncilService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findById.mockResolvedValue(sessao());
    repo.findTodasAsRespostas.mockResolvedValue([resposta()]);
    repo.findVotos.mockResolvedValue([]);
    repo.itemPertence.mockResolvedValue(true);

    service = new LootCouncilService(repo as unknown as LootSessionsRepository);
  });

  describe('o painel', () => {
    it('mostra o loot master, que é quem abriu a sessão', async () => {
      const p = await service.painel('sess-1', ATOR);

      expect(p.lootMasterBattletag).toBe('Loot#0001');
    });

    it('traz TODOS os itens, inclusive os sem candidato', async () => {
      // Peça que ninguém quis é informação. Sumir com ela faria o conselho achar
      // que a lista encolheu.
      const p = await service.painel('sess-1', ATOR);

      expect(p.itens.map((i) => i.itemId)).toEqual(['item-1', 'item-2']);
      expect(p.itens[1]?.candidatos).toEqual([]);
    });

    it('conta os votos por candidato e marca o do próprio conselheiro', async () => {
      repo.findVotos.mockResolvedValue([
        {
          itemId: 'item-1',
          candidateNameKey: 'fulano',
          candidateRealmKey: 'azralon',
          voterUserId: ATOR.userId,
        },
        {
          itemId: 'item-1',
          candidateNameKey: 'fulano',
          candidateRealmKey: 'azralon',
          voterUserId: OUTRO.userId,
        },
      ]);

      const p = await service.painel('sess-1', ATOR);

      expect(p.itens[0]?.candidatos[0]).toMatchObject({ votos: 2, meuVoto: true });
    });

    it('o voto de outro conselheiro não vira "meu voto"', async () => {
      repo.findVotos.mockResolvedValue([
        {
          itemId: 'item-1',
          candidateNameKey: 'fulano',
          candidateRealmKey: 'azralon',
          voterUserId: OUTRO.userId,
        },
      ]);

      const p = await service.painel('sess-1', ATOR);

      expect(p.itens[0]?.candidatos[0]).toMatchObject({ votos: 1, meuVoto: false });
    });

    it('ordena por voto, e o roll desempata', async () => {
      // Sugestão de leitura, nunca decisão — quem escolhe é o conselho.
      repo.findTodasAsRespostas.mockResolvedValue([
        resposta({ nameKey: 'a', name: 'A', roll: 10 }),
        resposta({ nameKey: 'b', name: 'B', roll: 90 }),
        resposta({ nameKey: 'c', name: 'C', roll: 50 }),
      ]);
      repo.findVotos.mockResolvedValue([
        {
          itemId: 'item-1',
          candidateNameKey: 'c',
          candidateRealmKey: 'azralon',
          voterUserId: OUTRO.userId,
        },
      ]);

      const p = await service.painel('sess-1', ATOR);

      // C tem 1 voto e vem primeiro; entre A e B, sem voto, o roll maior ganha.
      expect(p.itens[0]?.candidatos.map((c) => c.name)).toEqual(['C', 'B', 'A']);
    });

    it('sessão inexistente é 404', async () => {
      repo.findById.mockResolvedValueOnce(null);

      await expect(service.painel('nao-existe', ATOR)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('votar', () => {
    it('registra o voto no candidato', async () => {
      await service.votar(
        'sess-1',
        'item-1',
        { characterName: 'Fulano', characterRealm: 'Azralon' },
        ATOR,
      );

      expect(repo.votar).toHaveBeenCalledWith(
        expect.objectContaining({ candidato: { nameKey: 'fulano', realmKey: 'azralon' } }),
      );
    });

    it('só vale em deliberando', async () => {
      // Votar antes de as respostas fecharem é votar com informação incompleta.
      repo.findById.mockResolvedValue(sessao({ status: 'aberta' }));

      await expect(
        service.votar(
          'sess-1',
          'item-1',
          { characterName: 'Fulano', characterRealm: 'Azralon' },
          ATOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.votar).not.toHaveBeenCalled();
    });

    it('não dá para votar em quem não está disputando a peça', async () => {
      // Sem isto, um erro de digitação criaria voto para um personagem fora da
      // disputa, e a contagem apareceria ao lado de ninguém.
      await expect(
        service.votar(
          'sess-1',
          'item-1',
          { characterName: 'NaoDisputa', characterRealm: 'Azralon' },
          ATOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('o realm do voto é a chave frouxa', async () => {
      repo.findTodasAsRespostas.mockResolvedValue([resposta({ realmKey: 'area52' })]);

      await service.votar(
        'sess-1',
        'item-1',
        { characterName: 'Fulano', characterRealm: 'Area 52' },
        ATOR,
      );

      expect(repo.votar).toHaveBeenCalledWith(
        expect.objectContaining({ candidato: { nameKey: 'fulano', realmKey: 'area52' } }),
      );
    });
  });

  describe('reabrir resposta', () => {
    it('marca a resposta como aguardando', async () => {
      await service.reabrirResposta(
        'sess-1',
        'item-1',
        { characterName: 'Fulano', characterRealm: 'Azralon' },
        ATOR,
      );

      expect(repo.reabrirResposta).toHaveBeenCalled();
    });

    it('quem NÃO respondeu não é reaberto, e a mensagem diz o caminho', async () => {
      // Criar a linha aqui exigiria um slug que não existe na tabela de opções e
      // um roll que não é roll. O caminho é reabrir a sessão inteira.
      repo.reabrirResposta.mockResolvedValueOnce(false);

      await expect(
        service.reabrirResposta(
          'sess-1',
          'item-1',
          { characterName: 'Ninguem', characterRealm: 'Azralon' },
          ATOR,
        ),
      ).rejects.toThrow(/reabra a sessão inteira/);
    });

    it('item de outra sessão é 404', async () => {
      repo.itemPertence.mockResolvedValueOnce(false);

      await expect(
        service.reabrirResposta(
          'sess-1',
          'de-outra',
          { characterName: 'Fulano', characterRealm: 'Azralon' },
          ATOR,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('alterar a resposta de alguém', () => {
    it('troca a resposta', async () => {
      await service.alterarResposta(
        'sess-1',
        'item-1',
        { characterName: 'Fulano', characterRealm: 'Azralon', responseOptionSlug: 'upgrade' },
        ATOR,
      );

      expect(repo.alterarResposta).toHaveBeenCalledWith(
        expect.objectContaining({ responseOptionSlug: 'upgrade' }),
      );
    });

    it('opção inativa é recusada', async () => {
      await expect(
        service.alterarResposta(
          'sess-1',
          'item-1',
          { characterName: 'Fulano', characterRealm: 'Azralon', responseOptionSlug: 'transmog' },
          ATOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('alterar de quem não respondeu é 404', async () => {
      repo.alterarResposta.mockResolvedValueOnce(false);

      await expect(
        service.alterarResposta(
          'sess-1',
          'item-1',
          { characterName: 'Ninguem', characterRealm: 'Azralon', responseOptionSlug: 'bis' },
          ATOR,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
