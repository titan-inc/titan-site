import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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

/** Um voto, como o repositório devolve. Um por conselheiro por peça. */
const voto = (over: Record<string, unknown> = {}) => ({
  itemId: 'item-1',
  candidateNameKey: 'fulano',
  candidateRealmKey: 'azralon',
  voterUserId: ATOR.userId,
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
    findRazoesDoLootMaster: jest.fn<Promise<string[]>, []>(() =>
      Promise.resolve(['banking', 'disenchant', 'no_interest']),
    ),

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
    findAwards: jest.fn<
      Promise<
        Array<{
          itemId: string;
          winnerName: string;
          winnerRealm: string;
          responseOptionSlug: string;
          votes: number;
          note: string | null;
          awardedByBattletag: string;
          awardedAt: Date;
        }>
      >,
      [string]
    >(() => Promise.resolve([])),
    awardar: jest.fn<Promise<boolean>, [unknown]>(() => Promise.resolve(true)),
    findParticipantes: jest.fn<
      Promise<Array<{ nameKey: string; realmKey: string; name: string; realm: string }>>,
      [string]
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
    repo.findAwards.mockResolvedValue([]);
    repo.awardar.mockResolvedValue(true);
    repo.findParticipantes.mockResolvedValue([]);
    repo.findRazoesDoLootMaster.mockResolvedValue(['banking', 'disenchant', 'no_interest']);

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

  describe('quem está na sessão e não respondeu', () => {
    const participante = (over: Record<string, unknown> = {}) => ({
      nameKey: 'calado',
      realmKey: 'azralon',
      name: 'Calado',
      realm: 'Azralon',
      ...over,
    });

    it('aparece em TODAS as peças, com resposta e roll nulos', async () => {
      // Silêncio de quem estava na raid é informação para quem decide. Esconder
      // a linha faria a lista parecer menor do que a raid.
      repo.findParticipantes.mockResolvedValue([participante()]);

      const p = await service.painel('sess-1', ATOR);

      for (const item of p.itens) {
        const calado = item.candidatos.find((c) => c.name === 'Calado');
        expect(calado).toMatchObject({ responseOptionSlug: null, roll: null, votos: 0 });
      }
    });

    it('vem depois de quem respondeu', async () => {
      // A lista é para decidir, e quem não pediu não disputa.
      repo.findParticipantes.mockResolvedValue([
        participante(),
        participante({
          nameKey: 'fulano',
          name: 'Fulano',
        }),
      ]);

      const p = await service.painel('sess-1', ATOR);

      expect(p.itens[0]?.candidatos.map((c) => c.name)).toEqual(['Fulano', 'Calado']);
    });

    it('não vira linha duplicada de quem já respondeu', async () => {
      repo.findParticipantes.mockResolvedValue([
        participante({ nameKey: 'fulano', name: 'Fulano' }),
      ]);

      const p = await service.painel('sess-1', ATOR);

      expect(p.itens[0]?.candidatos).toHaveLength(1);
      expect(p.itens[0]?.candidatos[0]?.responseOptionSlug).toBe('bis');
    });

    it('não dá para votar em quem não declarou nada', async () => {
      // Voto é sobre quem declarou interesse. Quem ficou calado é alcançável
      // pelo award à mão e pelo `pass item to`, nunca pelo voto.
      repo.findParticipantes.mockResolvedValue([participante()]);

      await expect(
        service.votar(
          'sess-1',
          'item-1',
          { characterName: 'Calado', characterRealm: 'Azralon' },
          ATOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('nem em quem tem o silêncio já registrado como noop', async () => {
      // Depois que a fase de roll fecha, o silêncio vira linha de `noop` no
      // banco. Continua não sendo declaração de interesse.
      repo.findTodasAsRespostas.mockResolvedValue([
        resposta({ nameKey: 'calado', name: 'Calado', responseOptionSlug: 'noop', roll: null }),
      ]);

      await expect(
        service.votar(
          'sess-1',
          'item-1',
          { characterName: 'Calado', characterRealm: 'Azralon' },
          ATOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
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

  describe('pass item to', () => {
    const CALADO = { characterName: 'Calado', characterRealm: 'Azralon' };

    /** Alguém que entrou na sessão e não pediu nada. */
    const naSessao = () =>
      repo.findParticipantes.mockResolvedValue([
        { nameKey: 'calado', realmKey: 'azralon', name: 'Calado', realm: 'Azralon' },
      ]);

    const gravado = () => repo.awardar.mock.calls[0]?.[0];

    it('entrega a quem NÃO se candidatou, congelando a razão do loot master', async () => {
      // É a saída da peça que ninguém pediu. O `/award` recusaria esta pessoa.
      naSessao();

      await service.passItemTo(
        'sess-1',
        'item-1',
        { ...CALADO, responseOptionSlug: 'no_interest' },
        ATOR,
      );

      expect(gravado()).toMatchObject({
        vencedor: { nameKey: 'calado', realmKey: 'azralon' },
        responseOptionSlug: 'no_interest',
        // Sem votação, então zero é resultado e não lacuna.
        votes: 0,
        note: null,
      });
    });

    it('a razão precisa ser de loot master', async () => {
      // Senão a rota vira um jeito de forjar declaração alheia: o conselho
      // gravaria `bis` no nome de quem nunca pediu nada.
      naSessao();

      await expect(
        service.passItemTo('sess-1', 'item-1', { ...CALADO, responseOptionSlug: 'bis' }, ATOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.awardar).not.toHaveBeenCalled();
    });

    it('quem não está na sessão não recebe, e a mensagem diz por quê', async () => {
      // Regra do jogo, não nossa: a janela de trade só existe para quem estava
      // no grupo quando a peça caiu.
      await expect(
        service.passItemTo(
          'sess-1',
          'item-1',
          { characterName: 'DeFora', characterRealm: 'Azralon', responseOptionSlug: 'banking' },
          ATOR,
        ),
      ).rejects.toThrow(/janela de trade/);
    });

    it('vale para banking também: quem guarda estava na raid', async () => {
      naSessao();

      await service.passItemTo(
        'sess-1',
        'item-1',
        { ...CALADO, responseOptionSlug: 'banking' },
        ATOR,
      );

      expect(gravado()).toMatchObject({ responseOptionSlug: 'banking' });
    });

    it('grava a nota do loot master quando ela vem', async () => {
      naSessao();

      await service.passItemTo(
        'sess-1',
        'item-1',
        { ...CALADO, responseOptionSlug: 'banking', note: 'ninguém quis, foi pro banco' },
        ATOR,
      );

      expect(gravado()).toMatchObject({ note: 'ninguém quis, foi pro banco' });
    });

    it('só vale em deliberando', async () => {
      naSessao();
      repo.findById.mockResolvedValue(sessao({ status: 'aberta' }));

      await expect(
        service.passItemTo('sess-1', 'item-1', { ...CALADO, responseOptionSlug: 'banking' }, ATOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('peça já entregue por outro conselheiro dá conflito', async () => {
      naSessao();
      repo.awardar.mockResolvedValueOnce(false);

      await expect(
        service.passItemTo('sess-1', 'item-1', { ...CALADO, responseOptionSlug: 'banking' }, ATOR),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('a nota do loot master no award normal', () => {
    it('vai junto da entrega', async () => {
      await service.awardar(
        'sess-1',
        'item-1',
        { characterName: 'Fulano', characterRealm: 'Azralon', note: 'nunca recebeu nada' },
        ATOR,
      );

      expect(repo.awardar.mock.calls[0]?.[0]).toMatchObject({ note: 'nunca recebeu nada' });
    });

    it('sem nota, fica nulo — e não string vazia', async () => {
      await service.awardar(
        'sess-1',
        'item-1',
        { characterName: 'Fulano', characterRealm: 'Azralon' },
        ATOR,
      );

      expect(repo.awardar.mock.calls[0]?.[0]).toMatchObject({ note: null });
    });

    it('a entrega por maioria não inventa nota', async () => {
      // Ninguém escreveu uma: o botão entrega em massa.
      repo.findVotos.mockResolvedValue([voto()]);

      await service.awardarPorMaioria('sess-1', { itemId: 'item-1' }, ATOR);

      expect(repo.awardar.mock.calls[0]?.[0]).toMatchObject({ note: null });
    });

    it('a nota aparece no painel, junto do award', async () => {
      repo.findAwards.mockResolvedValue([
        {
          itemId: 'item-1',
          winnerName: 'Fulano',
          winnerRealm: 'Azralon',
          responseOptionSlug: 'bis',
          votes: 2,
          note: 'levou porque nunca recebeu nada esta season',
          awardedByBattletag: 'Loot#0001',
          awardedAt: new Date('2026-08-15T01:00:00.000Z'),
        },
      ]);

      const p = await service.painel('sess-1', ATOR);

      expect(p.itens[0]?.award?.note).toBe('levou porque nunca recebeu nada esta season');
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

  describe('o award no painel', () => {
    it('a peça entregue mostra o que valia no momento da decisão', async () => {
      // Congelado de propósito: depois do award a resposta ainda pode ser
      // corrigida, e o histórico guarda a decisão, não o que ficou depois.
      repo.findAwards.mockResolvedValue([
        {
          itemId: 'item-1',
          winnerName: 'Fulano',
          winnerRealm: 'Azralon',
          responseOptionSlug: 'bis',
          votes: 3,
          note: null,
          awardedByBattletag: 'Loot#0001',
          awardedAt: new Date('2026-08-15T01:00:00.000Z'),
        },
      ]);

      const p = await service.painel('sess-1', ATOR);

      expect(p.itens[0]?.award).toMatchObject({
        winnerName: 'Fulano',
        votes: 3,
        awardedByBattletag: 'Loot#0001',
        awardedAt: '2026-08-15T01:00:00.000Z',
      });
      // A peça sem dono continua distinguível da entregue.
      expect(p.itens[1]?.award).toBeNull();
    });
  });

  describe('awardar item a item', () => {
    const paraFulano = { characterName: 'Fulano', characterRealm: 'Azralon' };

    it('entrega à pessoa escolhida, com a resposta e os votos congelados', async () => {
      repo.findVotos.mockResolvedValue([voto(), voto({ voterUserId: OUTRO.userId })]);

      await service.awardar('sess-1', 'item-1', paraFulano, ATOR);

      expect(repo.awardar.mock.calls[0]?.[0]).toMatchObject({
        itemId: 'item-1',
        vencedor: { nameKey: 'fulano', realmKey: 'azralon' },
        responseOptionSlug: 'bis',
        votes: 2,
        ator: ATOR,
      });
    });

    it('só vale em deliberando', async () => {
      repo.findById.mockResolvedValue(sessao({ status: 'aberta' }));

      await expect(service.awardar('sess-1', 'item-1', paraFulano, ATOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.awardar).not.toHaveBeenCalled();
    });

    it('não entrega a quem não se candidatou', async () => {
      // Entregar a quem não pediu inverteria o que a sessão registra. Se a
      // pessoa deveria estar na disputa, o caminho é reabrir a resposta dela.
      await expect(
        service.awardar(
          'sess-1',
          'item-1',
          { characterName: 'Ninguem', characterRealm: 'Azralon' },
          ATOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.awardar).not.toHaveBeenCalled();
    });

    it('entrega a quem está com a resposta reaberta — aqui a escolha é explícita', async () => {
      // O contrário do award por maioria, que pula esse caso. A assimetria é o
      // ponto: item a item, quem decide está olhando a linha na tela.
      repo.findTodasAsRespostas.mockResolvedValue([resposta({ aguardandoNovaResposta: true })]);

      await service.awardar('sess-1', 'item-1', paraFulano, ATOR);

      expect(repo.awardar).toHaveBeenCalled();
    });

    it('dois conselheiros entregando a mesma peça: o segundo recebe conflito', async () => {
      // O `@@unique` no item é a trava. Sem ela seria sobrescrita silenciosa, e
      // duas pessoas sairiam da raid achando que levaram a peça.
      repo.awardar.mockResolvedValueOnce(false);

      await expect(service.awardar('sess-1', 'item-1', paraFulano, ATOR)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('item de outra sessão é 404', async () => {
      repo.itemPertence.mockResolvedValueOnce(false);

      await expect(service.awardar('sess-1', 'de-outra', paraFulano, ATOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('awardar por maioria', () => {
    /** Três candidatos na mesma peça, com rolls distintos. */
    const tresCandidatos = () => {
      repo.findTodasAsRespostas.mockResolvedValue([
        resposta({ nameKey: 'a', name: 'A', roll: 90 }),
        resposta({ nameKey: 'b', name: 'B', roll: 50 }),
        resposta({ nameKey: 'c', name: 'C', roll: 10 }),
      ]);
    };

    it('a peça vai para quem tem mais votos, mesmo com o roll menor', async () => {
      tresCandidatos();
      repo.findVotos.mockResolvedValue([voto({ candidateNameKey: 'c' })]);

      const r = await service.awardarPorMaioria('sess-1', { itemId: 'item-1' }, ATOR);

      expect(r).toEqual({ entregues: 1, pulados: [] });
      expect(repo.awardar.mock.calls[0]?.[0]).toMatchObject({
        vencedor: { name: 'C' },
        votes: 1,
      });
    });

    it('empate de votos NÃO é desempatado pelo roll', async () => {
      // O roll é auxílio visual, do mesmo tipo que o histórico de peças
      // recebidas: está na tela para o conselho olhar. Desempatar por ele seria
      // decidir por um critério que a tela apresenta como informação.
      tresCandidatos();
      repo.findVotos.mockResolvedValue([
        voto({ candidateNameKey: 'b' }),
        voto({ candidateNameKey: 'a', voterUserId: OUTRO.userId }),
      ]);

      const r = await service.awardarPorMaioria('sess-1', { itemId: 'item-1' }, ATOR);

      // A e B com um voto cada, e A tem roll 90 — ninguém leva mesmo assim.
      expect(r.entregues).toBe(0);
      expect(r.pulados[0]?.motivo).toMatch(/empate de votos entre/);
      expect(repo.awardar).not.toHaveBeenCalled();
    });

    it('sem voto nenhum, ninguém leva', async () => {
      // "Tudo de uma vez" clicado antes de o conselho votar sortearia a noite
      // inteira — e o award é imutável.
      tresCandidatos();

      const r = await service.awardarPorMaioria('sess-1', { itemId: 'item-1' }, ATOR);

      expect(r.entregues).toBe(0);
      expect(r.pulados[0]?.motivo).toMatch(/ainda não votou/);
    });

    it('candidato único sem voto também espera — votar é o trabalho do conselho', async () => {
      // Não existe decisão automática, nem na peça sem disputa. A peça sem
      // decisão segura o encerramento da sessão, e é assim que ela volta para
      // a mão de quem decide.
      const r = await service.awardarPorMaioria('sess-1', { itemId: 'item-1' }, ATOR);

      expect(r.entregues).toBe(0);
      expect(r.pulados[0]?.motivo).toMatch(/ainda não votou/);
    });

    it('com voto, o candidato único leva', async () => {
      repo.findVotos.mockResolvedValue([voto()]);

      const r = await service.awardarPorMaioria('sess-1', { itemId: 'item-1' }, ATOR);

      expect(r.entregues).toBe(1);
    });

    it('quem está com a resposta reaberta não leva por maioria', async () => {
      // Entregar congelaria justamente a resposta de que o conselho duvidou —
      // mesmo com o voto dado antes da reabertura.
      repo.findTodasAsRespostas.mockResolvedValue([resposta({ aguardandoNovaResposta: true })]);
      repo.findVotos.mockResolvedValue([voto()]);

      const r = await service.awardarPorMaioria('sess-1', { itemId: 'item-1' }, ATOR);

      expect(r.entregues).toBe(0);
      expect(r.pulados[0]?.motivo).toMatch(/resposta reaberta/);
    });

    it('peça sem candidato é pulada com o motivo, não some do resultado', async () => {
      repo.findTodasAsRespostas.mockResolvedValue([]);

      const r = await service.awardarPorMaioria('sess-1', { itemId: 'item-1' }, ATOR);

      expect(r.pulados).toEqual([{ itemId: 'item-1', motivo: 'ninguém se candidatou' }]);
    });

    it('sem itemId, percorre a sessão inteira e diz o que pulou', async () => {
      // Entregar 1 de 2 sem dizer o que houve com a outra faria o loot master
      // descobrir na hora de encerrar.
      repo.findTodasAsRespostas.mockResolvedValue([
        resposta({ itemId: 'item-1' }),
        resposta({ itemId: 'item-2', nameKey: 'b', name: 'B' }),
      ]);
      repo.findVotos.mockResolvedValue([voto()]);
      repo.findAwards.mockResolvedValue([
        {
          itemId: 'item-2',
          winnerName: 'B',
          winnerRealm: 'Azralon',
          responseOptionSlug: 'bis',
          votes: 1,
          note: null,
          awardedByBattletag: OUTRO.battletag,
          awardedAt: new Date('2026-08-15T01:00:00.000Z'),
        },
      ]);

      const r = await service.awardarPorMaioria('sess-1', {}, ATOR);

      expect(r).toEqual({ entregues: 1, pulados: [{ itemId: 'item-2', motivo: 'já entregue' }] });
      expect(repo.awardar).toHaveBeenCalledTimes(1);
    });

    it('lê as respostas uma vez só para a sessão inteira', async () => {
      // Recalcular por peça seriam quatro consultas vezes o número de peças,
      // para chegar sempre no mesmo lugar.
      await service.awardarPorMaioria('sess-1', {}, ATOR);

      expect(repo.findTodasAsRespostas).toHaveBeenCalledTimes(1);
      expect(repo.findVotos).toHaveBeenCalledTimes(1);
    });

    it('só vale em deliberando', async () => {
      repo.findById.mockResolvedValue(sessao({ status: 'aberta' }));

      await expect(service.awardarPorMaioria('sess-1', {}, ATOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.awardar).not.toHaveBeenCalled();
    });
  });
});
