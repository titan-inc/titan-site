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

    findHistoricoDosCandidatos: jest.fn<
      Promise<
        Array<{
          winnerNameKey: string;
          winnerRealmKey: string;
          awardedAt: Date;
          itemId: number;
          difficulty: string | null;
          responseOptionSlug: string;
        }>
      >,
      [Array<{ nameKey: string; realmKey: string }>]
    >(() => Promise.resolve([])),
    findItems: jest.fn<
      Promise<
        Array<{ itemId: number; name: string | null; icon: string | null; equipLoc: string | null }>
      >,
      [number[]]
    >(() => Promise.resolve([])),
  };

  let service: LootCouncilService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findById.mockResolvedValue(sessao());
    repo.findTodasAsRespostas.mockResolvedValue([resposta()]);
    repo.findVotos.mockResolvedValue([]);
    repo.itemPertence.mockResolvedValue(true);
    repo.findHistoricoDosCandidatos.mockResolvedValue([]);
    repo.findItems.mockResolvedValue([]);

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

  describe('o contexto embutido', () => {
    /** Uma entrega antiga, como o histórico devolve. */
    const entrega = (over: Record<string, unknown> = {}) => ({
      winnerNameKey: 'fulano',
      winnerRealmKey: 'azralon',
      awardedAt: new Date('2026-08-10T01:00:00.000Z'),
      itemId: 202612,
      difficulty: 'mythic',
      responseOptionSlug: 'bis',
      ...over,
    });

    it('mostra o que o candidato já recebeu, com nome do catálogo', async () => {
      repo.findHistoricoDosCandidatos.mockResolvedValue([entrega()]);
      repo.findItems.mockResolvedValue([
        { itemId: 202612, name: 'Ashen Sigil', icon: 'inv_ring', equipLoc: 'FINGER' },
      ]);

      const p = await service.painel('sess-1', ATOR);

      expect(p.itens[0]?.candidatos[0]?.recebidoAntes[0]).toMatchObject({
        itemName: 'Ashen Sigil',
        equipLoc: 'FINGER',
        difficulty: 'mythic',
        responseOptionSlug: 'bis',
      });
    });

    it('sem histórico, a lista é vazia — e isso é informação', async () => {
      // Quem nunca levou nada tem argumento. Vazio aqui não é falta de dado.
      const p = await service.painel('sess-1', ATOR);

      expect(p.itens[0]?.candidatos[0]?.recebidoAntes).toEqual([]);
    });

    it('corta em 5 por pessoa, do mais recente', async () => {
      // O conselho decide com o recente. Quem quer tudo abre a aba de Histórico.
      repo.findHistoricoDosCandidatos.mockResolvedValue(
        // Dias 10 a 02, do mais recente. Zero à esquerda importa: `2026-08-2`
        // é data inválida e estoura no `toISOString()`.
        Array.from({ length: 9 }, (_, i) =>
          entrega({
            awardedAt: new Date(`2026-08-${String(10 - i).padStart(2, '0')}T01:00:00.000Z`),
          }),
        ),
      );

      const p = await service.painel('sess-1', ATOR);
      const recebidos = p.itens[0]?.candidatos[0]?.recebidoAntes ?? [];

      expect(recebidos).toHaveLength(5);
      expect(recebidos[0]?.awardedAt).toBe('2026-08-10T01:00:00.000Z');
    });

    it('o corte é POR PESSOA, não no total', async () => {
      // O erro que isto tranca: cortar a lista inteira em 5 deixaria o segundo
      // candidato sem histórico nenhum quando o primeiro tivesse muitos.
      repo.findTodasAsRespostas.mockResolvedValue([
        resposta({ nameKey: 'a', name: 'A' }),
        resposta({ nameKey: 'b', name: 'B' }),
      ]);
      repo.findHistoricoDosCandidatos.mockResolvedValue([
        ...Array.from({ length: 6 }, () => entrega({ winnerNameKey: 'a' })),
        entrega({ winnerNameKey: 'b' }),
      ]);

      const p = await service.painel('sess-1', ATOR);
      const porNome = new Map(p.itens[0]?.candidatos.map((c) => [c.name, c.recebidoAntes]));

      expect(porNome.get('A')).toHaveLength(5);
      expect(porNome.get('B')).toHaveLength(1);
    });

    it('pede o histórico UMA vez para todos os candidatos', async () => {
      // A tela reabre o painel a cada voto; N+1 aqui seriam 26 idas ao banco
      // por clique.
      repo.findTodasAsRespostas.mockResolvedValue([
        resposta({ nameKey: 'a' }),
        resposta({ nameKey: 'b' }),
        resposta({ nameKey: 'c' }),
      ]);

      await service.painel('sess-1', ATOR);

      expect(repo.findHistoricoDosCandidatos).toHaveBeenCalledTimes(1);
      expect(repo.findHistoricoDosCandidatos.mock.calls[0]?.[0]).toHaveLength(3);
    });

    it('não repete a mesma pessoa quando ela disputa duas peças', async () => {
      repo.findTodasAsRespostas.mockResolvedValue([
        resposta({ itemId: 'item-1' }),
        resposta({ itemId: 'item-2' }),
      ]);

      await service.painel('sess-1', ATOR);

      expect(repo.findHistoricoDosCandidatos.mock.calls[0]?.[0]).toHaveLength(1);
    });

    it('item fora do catálogo entra sem nome, e a linha não some', async () => {
      repo.findHistoricoDosCandidatos.mockResolvedValue([entrega()]);
      repo.findItems.mockResolvedValue([]);

      const p = await service.painel('sess-1', ATOR);

      expect(p.itens[0]?.candidatos[0]?.recebidoAntes[0]).toMatchObject({ itemName: null });
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
