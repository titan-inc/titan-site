import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { LootLinesService } from '../loot-lines/loot-lines.service';
import { LootSessionsService } from './loot-sessions.service';
import type { PersonagemDaConta } from './loot-sessions.service';
import type {
  Ator,
  AwardParaHistorico,
  ItemDaSessao,
  LootSessionsRepository,
  SessionRow,
} from './loot-sessions.repository';

/** Sentinela para provar que o client de transação chegou ao chamado certo. */
const FAKE_TX = { fake: 'tx' };

/**
 * Colagem no formato real. Nomes fictícios — o repo é público.
 *
 * O `encounter=2688` é Kazzara, que existe no catálogo; o segundo cabeçalho usa
 * um id que não existe, para o caso de boss não cadastrado.
 */
const cabecalho = (encounter: number | string = 2688) =>
  [
    'TILC/1',
    `encounter=${encounter}`,
    'encounterName=Kazzara, the Hellforged',
    'difficulty=14',
    'instance=2569',
    'instanceName=Aberrus, the Shadowed Crucible',
  ].join('\t');

const MITICO = 'item:202612::::::::90:250::6:5:9323:7979:6652:1472:8767:1:28:2645:::::';
const RECEITA = 'item:204717::::::::90:250:::::::::';

const colagem = (...linhas: string[]) => [cabecalho(), ...linhas].join('\n');
const linhaDeItem = (itemString: string, looter = 'Fulano-Azralon') =>
  [itemString, looter, 'auto'].join('\t');

const ATOR: Ator = { userId: 'user-1', battletag: 'Loot#0001' };
const OUTRA_PESSOA: Ator = { userId: 'user-2', battletag: 'Outro#0002' };

/** Uma participação, como o repositório devolve. */
const participacao = (de: Ator = ATOR) => ({
  userId: de.userId,
  battletag: de.battletag,
  nameKey: de === ATOR ? 'fulano' : 'ciclano',
  realmKey: de === ATOR ? 'azralon' : 'area52',
  name: de === ATOR ? 'Fulano' : 'Ciclano',
  realm: de === ATOR ? 'azralon' : 'area-52',
  joinedAt: new Date('2026-08-15T01:10:00.000Z'),
});

/** Os personagens da conta, como o roster os guarda. Rank 0 é o melhor. */
const PERSONAGENS: PersonagemDaConta[] = [
  { nameKey: 'fulano', realmSlug: 'azralon', name: 'Fulano', rank: 4 },
  { nameKey: 'ciclano', realmSlug: 'area-52', name: 'Ciclano', rank: 2 },
];

/** O que o repositório recebe para gravar uma resposta. */
interface RespostaGravada {
  sessionId: string;
  itemId: string;
  personagem: { nameKey: string; realmKey: string; name: string; realm: string };
  responseOptionSlug: string;
  roll: number;
  note: string | null | undefined;
  ator: Ator;
}

const sessaoDoBanco = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: 'sess-1',
  status: 'rascunho',
  difficulty: 'normal',
  rawEncounterName: 'Kazzara, the Hellforged',
  rawInstanceName: 'Aberrus, the Shadowed Crucible',
  createdByBattletag: 'Loot#0001',
  createdAt: new Date('2026-08-15T01:00:00.000Z'),
  openedAt: null,
  encounter: { id: 'enc-kazzara', name: 'Kazzara, the Hellforged', raid: { name: 'Aberrus' } },
  items: [
    {
      id: 'item-1',
      position: 1,
      itemId: 202612,
      itemString: MITICO,
      looter: {
        id: 'char-fulano',
        nameKey: 'fulano',
        realmKey: 'azralon',
        name: 'Fulano',
        realm: 'Azralon',
      },
    },
  ],
  ...over,
});

describe('LootSessionsService', () => {
  // Os argumentos vão no genérico do `jest.fn` para o `mock.calls` vir tipado —
  // é por ele que os testes conferem o que o serviço mandou gravar.
  const repo = {
    criar: jest.fn<Promise<string>, [{ itens: ItemDaSessao[]; encounterId: string | null }]>(() =>
      Promise.resolve('sess-1'),
    ),
    findById: jest.fn<Promise<SessionRow | null>, [string]>(() => Promise.resolve(sessaoDoBanco())),
    findEncounterByDungeonId: jest.fn<Promise<{ id: string } | null>, [number]>(() =>
      Promise.resolve({ id: 'enc-kazzara' }),
    ),
    findItems: jest.fn<
      Promise<
        Array<{ itemId: number; name: string | null; icon: string | null; equipLoc: string | null }>
      >,
      [number[]]
    >(() =>
      Promise.resolve([
        { itemId: 202612, name: 'Ashen Sigil', icon: 'inv_ring', equipLoc: 'FINGER' },
      ]),
    ),
    garantirItens: jest.fn<Promise<void>, [number[]]>(() => Promise.resolve()),
    findAbertas: jest.fn<Promise<[]>, []>(() => Promise.resolve([])),
    proximaPosicao: jest.fn<Promise<number>, [string]>(() => Promise.resolve(2)),
    adicionarItem: jest.fn<Promise<void>, [string, ItemDaSessao, Ator]>(() => Promise.resolve()),
    removerItem: jest.fn<Promise<boolean>, [string, string, Ator]>(() => Promise.resolve(true)),
    trocarStatus: jest.fn<Promise<void>, [string, string, string, Ator, boolean]>(() =>
      Promise.resolve(),
    ),

    responder: jest.fn<Promise<void>, [RespostaGravada]>(() => Promise.resolve()),
    findRespostasDoPersonagem: jest.fn<
      Promise<
        Array<{
          itemId: string;
          responseOptionSlug: string;
          roll: number | null;
          note: string | null;
          aguardandoNovaResposta: boolean;
          name: string;
        }>
      >,
      [string, string, string]
    >(() => Promise.resolve([])),
    findAwards: jest.fn<Promise<Array<{ itemId: string }>>, [string]>(() => Promise.resolve([])),
    findAwardsParaHistorico: jest.fn<Promise<AwardParaHistorico[]>, [string]>(() =>
      Promise.resolve([]),
    ),
    encerrarComHistorico: jest.fn<
      Promise<number>,
      [string, string, Ator, (tx: unknown) => Promise<number>]
    >((_id, _de, _ator, gravarLinhas) => gravarLinhas(FAKE_TX)),
    entrar: jest.fn<Promise<void>, [unknown]>(() => Promise.resolve()),
    findParticipantes: jest.fn<
      Promise<
        Array<{
          userId: string;
          battletag: string;
          nameKey: string;
          realmKey: string;
          name: string;
          realm: string;
          joinedAt: Date;
        }>
      >,
      [string]
    >(() => Promise.resolve([])),
    registrarSilencio: jest.fn<Promise<number>, [string, Ator]>(() => Promise.resolve(0)),
    findTodasAsRespostas: jest.fn<
      Promise<
        Array<{
          itemId: string;
          name: string;
          realm: string;
          responseOptionSlug: string;
          roll: number | null;
          note: string | null;
        }>
      >,
      [string]
    >(() => Promise.resolve([])),
    contarRespostas: jest.fn<Promise<Map<string, number>>, [string]>(() =>
      Promise.resolve(new Map()),
    ),
    itemPertence: jest.fn<Promise<boolean>, [string, string]>(() => Promise.resolve(true)),
    findSlugsAtivos: jest.fn<Promise<string[]>, []>(() =>
      Promise.resolve(['bis', 'upgrade', 'pass']),
    ),
    findOpcoesDoJogador: jest.fn<Promise<Array<{ slug: string; label: string }>>, []>(() =>
      Promise.resolve([
        { slug: 'bis', label: 'BiS' },
        { slug: 'upgrade', label: 'Upgrade' },
        { slug: 'pass', label: 'Pass' },
      ]),
    ),
  };

  const lootLines = {
    gravarDaSessao: jest.fn<
      Promise<number>,
      [{ sessionId: string; encounterId: string | null; itens: AwardParaHistorico[] }, unknown?]
    >(() => Promise.resolve(0)),
  };

  let service: LootSessionsService;

  /** Os itens que o serviço mandou gravar na criação. */
  const itensGravados = (): ItemDaSessao[] => {
    const chamada = repo.criar.mock.calls[0];
    if (chamada === undefined) throw new Error('criar não foi chamado');
    return chamada[0].itens;
  };

  beforeEach(() => {
    // `clearAllMocks` zera as CHAMADAS, não as implementações: um
    // `mockResolvedValue` de um teste vaza para os seguintes. Repor o padrão
    // aqui é o que impede um teste de passar (ou falhar) por causa do vizinho.
    jest.clearAllMocks();
    repo.findById.mockResolvedValue(sessaoDoBanco());
    repo.findRespostasDoPersonagem.mockResolvedValue([]);
    repo.contarRespostas.mockResolvedValue(new Map());
    repo.findEncounterByDungeonId.mockResolvedValue({ id: 'enc-kazzara' });
    repo.itemPertence.mockResolvedValue(true);
    repo.findAwards.mockResolvedValue([]);
    repo.findAwardsParaHistorico.mockResolvedValue([]);
    repo.encerrarComHistorico.mockImplementation((_id, _de, _ator, gravarLinhas) =>
      gravarLinhas(FAKE_TX),
    );
    lootLines.gravarDaSessao.mockResolvedValue(0);
    repo.findParticipantes.mockResolvedValue([]);
    repo.registrarSilencio.mockResolvedValue(0);
    repo.findTodasAsRespostas.mockResolvedValue([]);
    repo.findOpcoesDoJogador.mockResolvedValue([
      { slug: 'bis', label: 'BiS' },
      { slug: 'upgrade', label: 'Upgrade' },
      { slug: 'pass', label: 'Pass' },
    ]);

    service = new LootSessionsService(
      repo as unknown as LootSessionsRepository,
      lootLines as unknown as LootLinesService,
    );
  });

  describe('criar da colagem', () => {
    it('a sessão nasce montada, com o boss do catálogo', async () => {
      await service.criarDaColagem(colagem(linhaDeItem(MITICO)), ATOR);

      expect(repo.findEncounterByDungeonId).toHaveBeenCalledWith(2688);
      expect(repo.criar).toHaveBeenCalledWith(
        expect.objectContaining({ encounterId: 'enc-kazzara', difficulty: 'normal' }),
      );
    });

    it('boss fora do catálogo NÃO recusa a colagem', async () => {
      // O catálogo é cadastro manual e o addon exporta qualquer boss que o grupo
      // matar. Recusar pararia a raid por causa de um cadastro faltando.
      repo.findEncounterByDungeonId.mockResolvedValueOnce(null);

      const r = await service.criarDaColagem(colagem(linhaDeItem(MITICO)), ATOR);

      expect(repo.criar).toHaveBeenCalledWith(expect.objectContaining({ encounterId: null }));
      // E o nome cru da colagem vira o rótulo, como nos 26% do histórico.
      expect(r.session.encounter.name).toBeTruthy();
    });

    it('item fora do catálogo é criado no dicionário, não recusado', async () => {
      await service.criarDaColagem(colagem(linhaDeItem(MITICO), linhaDeItem(RECEITA)), ATOR);

      expect(repo.garantirItens).toHaveBeenCalledWith([202612, 204717]);
    });

    it('guarda o looter como ENTRADA, sem virar vencedor', async () => {
      // Ler o looter como destinatário final inverteria o propósito da
      // ferramenta: quem fica com a peça é decisão do conselho.
      await service.criarDaColagem(colagem(linhaDeItem(MITICO, 'Ciclano-Area52')), ATOR);

      expect(itensGravados()[0]).toMatchObject({
        looterName: 'Ciclano',
        looterRealm: 'Area52',
      });
    });

    it('devolve os problemas junto, em vez de escondê-los', async () => {
      // Linha torta não derruba a colagem, mas o loot master precisa ver o que
      // não entrou — senão a perda só aparece na hora de awardar.
      const r = await service.criarDaColagem(
        colagem(linhaDeItem(MITICO), 'lixo\tFulano-Azralon\tauto'),
        ATOR,
      );

      expect(r.problemas).toHaveLength(1);
      expect(itensGravados()).toHaveLength(1);
    });

    it('colagem sem item nenhum é recusada, com os problemas na resposta', async () => {
      const criar = service.criarDaColagem(colagem('lixo\tFulano-Azralon\tauto'), ATOR);

      await expect(criar).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.criar).not.toHaveBeenCalled();
    });

    it('cabeçalho inválido vira 400, não 500', async () => {
      // Colagem errada é erro de quem colou. 500 mandaria tentar de novo e
      // enganaria o alarme de produção.
      await expect(service.criarDaColagem('oi tudo bem', ATOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('detalhe', () => {
    it('nome e ícone vêm do catálogo, e os modificadores do itemString', async () => {
      const d = await service.detalhe('sess-1', ATOR);

      expect(d.items[0]).toMatchObject({
        itemId: 202612,
        name: 'Ashen Sigil',
        icon: 'inv_ring',
        itemContext: 6,
        bonusIds: [9323, 7979, 6652, 1472, 8767],
      });
    });

    it('item que o catálogo não tem entra sem nome', async () => {
      repo.findItems.mockResolvedValueOnce([]);

      const d = await service.detalhe('sess-1', ATOR);

      expect(d.items[0]?.name).toBeNull();
      expect(d.items[0]?.itemId).toBe(202612);
    });

    it('sessão inexistente é 404', async () => {
      repo.findById.mockResolvedValueOnce(null);

      await expect(service.detalhe('nao-existe', ATOR)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('a lista de itens congela quando a sessão abre', () => {
    it('acrescentar em rascunho funciona', async () => {
      await service.adicionarItem('sess-1', { itemString: RECEITA }, ATOR);

      expect(repo.adicionarItem).toHaveBeenCalled();
    });

    it('acrescentar com a sessão aberta é recusado', async () => {
      // Acrescentar depois de anunciado muda o que as pessoas responderam sem
      // elas saberem.
      repo.findById.mockResolvedValueOnce(sessaoDoBanco({ status: 'aberta' }));

      await expect(
        service.adicionarItem('sess-1', { itemString: RECEITA }, ATOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.adicionarItem).not.toHaveBeenCalled();
    });

    it('remover com a sessão aberta é recusado', async () => {
      repo.findById.mockResolvedValueOnce(sessaoDoBanco({ status: 'aberta' }));

      await expect(service.removerItem('sess-1', 'item-1', ATOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('remover item de outra sessão é 404', async () => {
      repo.removerItem.mockResolvedValueOnce(false);

      await expect(service.removerItem('sess-1', 'de-outra', ATOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('itemString ilegível ao acrescentar é 400', async () => {
      await expect(
        service.adicionarItem('sess-1', { itemString: 'item:abc' }, ATOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('entrar na sessão', () => {
    const entrou = (): { nameKey: string; realmKey: string; name: string; realm: string } => {
      const chamada = repo.entrar.mock.calls[0]?.[0] as {
        personagem: { nameKey: string; realmKey: string; name: string; realm: string };
      };
      if (chamada === undefined) throw new Error('entrar não foi chamado');
      return chamada.personagem;
    };

    it('entra com o personagem escolhido', async () => {
      await service.entrar(
        'sess-1',
        { characterName: 'Fulano', characterRealm: 'azralon' },
        ATOR,
        PERSONAGENS,
      );

      expect(entrou()).toMatchObject({ nameKey: 'fulano', name: 'Fulano' });
    });

    it('o realm da identidade é a chave frouxa', async () => {
      // `area-52` do roster vira `area52`, que é como a linha de loot e a
      // presença guardam — Regra 6.
      await service.entrar(
        'sess-1',
        { characterName: 'Ciclano', characterRealm: 'Area 52' },
        ATOR,
        PERSONAGENS,
      );

      expect(entrou().realmKey).toBe('area52');
    });

    it('personagem que não é da conta é recusado', async () => {
      // Aceitar qualquer nome deixaria entrar no lugar de outra pessoa — e daí
      // responder e receber peça no lugar dela.
      await expect(
        service.entrar(
          'sess-1',
          { characterName: 'DeOutraPessoa', characterRealm: 'azralon' },
          ATOR,
          PERSONAGENS,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.entrar).not.toHaveBeenCalled();
    });

    it('conta sem personagem no roster não entra', async () => {
      await expect(
        service.entrar('sess-1', { characterName: 'Fulano', characterRealm: 'azralon' }, ATOR, []),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('trocar de personagem antes de responder funciona', async () => {
      repo.findParticipantes.mockResolvedValue([participacao()]);

      await service.entrar(
        'sess-1',
        { characterName: 'Ciclano', characterRealm: 'area-52' },
        ATOR,
        PERSONAGENS,
      );

      expect(entrou().nameKey).toBe('ciclano');
    });

    it('trocar DEPOIS de responder é recusado', async () => {
      // A resposta guarda o char com que foi dada. Trocar deixaria a pessoa em
      // duas linhas do painel, e a tela dela diria que não respondeu.
      repo.findParticipantes.mockResolvedValue([participacao()]);
      repo.findRespostasDoPersonagem.mockResolvedValue([
        {
          itemId: 'item-1',
          responseOptionSlug: 'bis',
          roll: 40,
          note: null,
          aguardandoNovaResposta: false,
          name: 'Fulano',
        },
      ]);

      await expect(
        service.entrar(
          'sess-1',
          { characterName: 'Ciclano', characterRealm: 'area-52' },
          ATOR,
          PERSONAGENS,
        ),
      ).rejects.toThrow(/já respondeu com Fulano/);
      expect(repo.entrar).not.toHaveBeenCalled();
    });

    it('repetir o clique no MESMO personagem não é troca', async () => {
      repo.findParticipantes.mockResolvedValue([participacao()]);
      repo.findRespostasDoPersonagem.mockResolvedValue([
        {
          itemId: 'item-1',
          responseOptionSlug: 'bis',
          roll: 40,
          note: null,
          aguardandoNovaResposta: false,
          name: 'Fulano',
        },
      ]);

      await service.entrar(
        'sess-1',
        { characterName: 'Fulano', characterRealm: 'azralon' },
        ATOR,
        PERSONAGENS,
      );

      expect(repo.entrar).toHaveBeenCalled();
    });

    it('sessão encerrada não recebe mais ninguém', async () => {
      repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'encerrada' }));

      await expect(
        service.entrar(
          'sess-1',
          { characterName: 'Fulano', characterRealm: 'azralon' },
          ATOR,
          PERSONAGENS,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('o detalhe traz quem está na sessão, e a própria participação', async () => {
      repo.findParticipantes.mockResolvedValue([participacao(), participacao(OUTRA_PESSOA)]);

      const d = await service.detalhe('sess-1', ATOR);

      expect(d.participantes).toHaveLength(2);
      expect(d.minhaParticipacao).toMatchObject({ name: 'Fulano' });
      // O `userId` identifica a conta e não sai para a tela, que fala de
      // personagem.
      expect(JSON.stringify(d.participantes)).not.toContain('user-1');
    });

    it('quem não entrou não tem participação', async () => {
      repo.findParticipantes.mockResolvedValue([participacao(OUTRA_PESSOA)]);

      const d = await service.detalhe('sess-1', ATOR);

      expect(d.minhaParticipacao).toBeNull();
    });
  });

  describe('o jogador responde', () => {
    const aberta = () => {
      repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'aberta' }));
      repo.findParticipantes.mockResolvedValue([participacao()]);
    };

    /** O que o serviço mandou gravar. */
    const gravado = (): RespostaGravada => {
      const chamada = repo.responder.mock.calls[0];
      if (chamada === undefined) throw new Error('responder não foi chamado');
      return chamada[0];
    };

    it('grava a resposta com um roll do servidor, entre 1 e 100', async () => {
      aberta();

      await service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR);

      expect(gravado().responseOptionSlug).toBe('bis');
      expect(gravado().roll).toBeGreaterThanOrEqual(1);
      expect(gravado().roll).toBeLessThanOrEqual(100);
    });

    it('o roll NÃO vem do cliente', async () => {
      // Aceitar o roll do corpo deixaria mandar 100. O schema não tem o campo, e
      // mandar assim mesmo não muda nada.
      aberta();

      await service.responder(
        'sess-1',
        'item-1',
        { responseOptionSlug: 'bis', roll: 100 } as never,
        ATOR,
      );

      // Um roll do servidor cair exatamente em 100 é 1%, então isto não é flaky
      // por acaso — o que se testa é que o campo do cliente foi ignorado.
      expect(Object.keys(gravado())).toContain('roll');
      expect(gravado().roll).toBeGreaterThanOrEqual(1);
    });

    it('a resposta herda o personagem da PARTICIPAÇÃO', async () => {
      // Antes o personagem vinha no corpo e caía no representante da conta
      // quando não vinha — e errava justamente para quem raida no alt, em
      // silêncio. Aqui a pessoa entrou com Fulano, e é Fulano que responde.
      aberta();

      await service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR);

      expect(gravado().personagem).toMatchObject({
        nameKey: 'fulano',
        realmKey: 'azralon',
        name: 'Fulano',
      });
    });

    it('grava a nota junto da escolha', async () => {
      aberta();

      await service.responder(
        'sess-1',
        'item-1',
        { responseOptionSlug: 'upgrade', note: 'tanko o segundo boss' },
        ATOR,
      );

      expect(gravado().note).toBe('tanko o segundo boss');
    });

    it('sem o campo, a nota que já existe é preservada', async () => {
      // Se omitir apagasse, trocar só a escolha limparia o que a pessoa
      // escreveu, em silêncio. `undefined` não entra no UPDATE do Prisma.
      aberta();

      await service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR);

      expect(gravado().note).toBeUndefined();
    });

    it('com o campo vazio, apaga', async () => {
      // Vazio é intenção declarada de não ter nota — o schema já transforma em
      // nulo, e nulo chega ao UPDATE.
      aberta();

      await service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis', note: null }, ATOR);

      expect(gravado().note).toBeNull();
    });

    it('a própria nota volta no detalhe', async () => {
      aberta();
      repo.findRespostasDoPersonagem.mockResolvedValue([
        {
          itemId: 'item-1',
          responseOptionSlug: 'upgrade',
          roll: 73,
          note: 'tanko o segundo boss',
          aguardandoNovaResposta: false,
          name: 'Fulano',
        },
      ]);

      const d = await service.detalhe('sess-1', ATOR);

      expect(d.items[0]?.minhaResposta?.note).toBe('tanko o segundo boss');
    });

    it('quem NÃO entrou na sessão não responde', async () => {
      // Sem isto o "Entrar" seria decorativo, e a lista de quem estava na raid
      // não bateria com quem respondeu.
      aberta();
      repo.findParticipantes.mockResolvedValue([participacao(OUTRA_PESSOA)]);

      await expect(
        service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.responder).not.toHaveBeenCalled();
    });

    it('opção de resposta inativa é recusada', async () => {
      // A tabela é configurável e a liderança desativa opção. Aceitar a
      // desativada deixaria entrar resposta que a tela nem oferece mais.
      aberta();

      await expect(
        service.responder('sess-1', 'item-1', { responseOptionSlug: 'transmog' }, ATOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('item de outra sessão é 404', async () => {
      aberta();
      repo.itemPertence.mockResolvedValueOnce(false);

      await expect(
        service.responder('sess-1', 'de-outra', { responseOptionSlug: 'bis' }, ATOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('em rascunho ainda não dá para responder', async () => {
      // A lista de itens nem foi anunciada.
      repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'rascunho' }));

      await expect(
        service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    describe('em deliberando, só responde quem o conselho reabriu', () => {
      const respostaDoItem = (aguardando: boolean) => [
        {
          itemId: 'item-1',
          responseOptionSlug: 'bis',
          roll: 73,
          note: null,
          aguardandoNovaResposta: aguardando,
          name: 'Ciclano',
        },
      ];

      it('com reabertura, responde', async () => {
        repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'deliberando' }));
        repo.findParticipantes.mockResolvedValue([participacao()]);
        repo.findRespostasDoPersonagem.mockResolvedValue(respostaDoItem(true));

        await service.responder('sess-1', 'item-1', { responseOptionSlug: 'upgrade' }, ATOR);

        expect(repo.responder).toHaveBeenCalled();
      });

      it('sem reabertura, é recusado', async () => {
        // O conselho já está votando em cima da resposta declarada. Deixar mudar
        // embaixo faria o voto ser sobre uma coisa e a decisão sobre outra.
        repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'deliberando' }));
        repo.findRespostasDoPersonagem.mockResolvedValue(respostaDoItem(false));

        await expect(
          service.responder('sess-1', 'item-1', { responseOptionSlug: 'upgrade' }, ATOR),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(repo.responder).not.toHaveBeenCalled();
      });

      it('quem nunca respondeu também é barrado', async () => {
        // Trazer essa pessoa de volta é ação do conselho, não dela. O mecanismo
        // é a TIT-66, que precisa saber reabrir para quem não tem resposta.
        repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'deliberando' }));
        repo.findRespostasDoPersonagem.mockResolvedValue([]);

        await expect(
          service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('a reabertura vale para o item reaberto, não para os outros', async () => {
        // Reabrir uma peça não pode virar passe livre na sessão inteira.
        repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'deliberando' }));
        repo.findRespostasDoPersonagem.mockResolvedValue(respostaDoItem(true));
        repo.itemPertence.mockResolvedValue(true);

        await expect(
          service.responder('sess-1', 'outro-item', { responseOptionSlug: 'bis' }, ATOR),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    it('em aberta a resposta é livre, sem precisar de reabertura', async () => {
      repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'aberta' }));
      repo.findParticipantes.mockResolvedValue([participacao()]);
      repo.findRespostasDoPersonagem.mockResolvedValue([]);

      await service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR);

      expect(repo.responder).toHaveBeenCalled();
    });

    it('sessão encerrada não aceita mais resposta', async () => {
      repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'encerrada' }));

      await expect(
        service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('privacidade da sessão', () => {
    it('mostra a própria resposta e o próprio roll', async () => {
      repo.findParticipantes.mockResolvedValue([participacao()]);
      repo.findRespostasDoPersonagem.mockResolvedValue([
        {
          itemId: 'item-1',
          responseOptionSlug: 'bis',
          roll: 73,
          note: null,
          aguardandoNovaResposta: false,
          name: 'Ciclano',
        },
      ]);

      const d = await service.detalhe('sess-1', ATOR);

      expect(d.items[0]?.minhaResposta).toMatchObject({ responseOptionSlug: 'bis', roll: 73 });
    });

    it('sem participação, não vem resposta — o padrão é fechado', async () => {
      const d = await service.detalhe('sess-1', ATOR);

      expect(d.items[0]?.minhaResposta).toBeNull();
    });

    it('mostra a CONTAGEM de respostas, e só ela, do que é dos outros', async () => {
      // Dá a noção de que a sala está andando sem entregar o que os outros
      // declararam — ver a resposta alheia durante a deliberação muda o que as
      // pessoas respondem.
      //
      // 12 respostas na peça, e quem olha não respondeu: o único roll que
      // poderia aparecer seria de outra pessoa, e não aparece nenhum.
      repo.contarRespostas.mockResolvedValueOnce(new Map([['item-1', 12]]));

      const d = await service.detalhe('sess-1', ATOR);

      expect(d.items[0]?.totalDeRespostas).toBe(12);
      expect(d.items[0]?.minhaResposta).toBeNull();
      expect(JSON.stringify(d)).not.toContain('roll');
    });

    it('manda as opções de resposta junto da sessão', async () => {
      // Vêm com a sessão, e não de um endpoint próprio: assim o botão que a
      // tela mostra é necessariamente o que a API aceita. A lista é
      // configurável, e duas fontes divergiriam quando alguém desativasse uma.
      const d = await service.detalhe('sess-1', ATOR);

      expect(d.opcoesDeResposta.map((o) => o.slug)).toEqual(['bis', 'upgrade', 'pass']);
    });

    it('na fase de roll, a resposta alheia NÃO sai da API', async () => {
      // Não é a tela que esconde: o payload não carrega. Uma tela que filtrasse
      // deixaria o conteúdo a um F12 de distância de qualquer pessoa da raid.
      repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'aberta' }));

      const d = await service.detalhe('sess-1', ATOR);

      expect(d.items[0]?.respostas).toEqual([]);
      expect(repo.findTodasAsRespostas).not.toHaveBeenCalled();
    });

    it('quando as respostas fecham, todo mundo vê tudo', async () => {
      repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'deliberando' }));
      repo.findTodasAsRespostas.mockResolvedValue([
        {
          itemId: 'item-1',
          name: 'Fulano',
          realm: 'azralon',
          responseOptionSlug: 'bis',
          roll: 63,
          note: null,
        },
        {
          itemId: 'item-1',
          name: 'Ciclano',
          realm: 'area-52',
          responseOptionSlug: 'noop',
          roll: null,
          note: null,
        },
      ]);

      const d = await service.detalhe('sess-1', ATOR);

      expect(d.items[0]?.respostas).toEqual([
        { name: 'Fulano', realm: 'azralon', responseOptionSlug: 'bis', roll: 63, note: null },
        { name: 'Ciclano', realm: 'area-52', responseOptionSlug: 'noop', roll: null, note: null },
      ]);
    });

    it('a sessão encerrada continua aberta para leitura', async () => {
      // Ela vira histórico, e histórico de loot é aberto — Regra 7.
      repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'encerrada' }));
      repo.findTodasAsRespostas.mockResolvedValue([
        {
          itemId: 'item-1',
          name: 'Fulano',
          realm: 'azralon',
          responseOptionSlug: 'bis',
          roll: 63,
          note: null,
        },
      ]);

      const d = await service.detalhe('sess-1', ATOR);

      expect(d.items[0]?.respostas).toHaveLength(1);
    });

    it('em rascunho também não sai nada', async () => {
      const d = await service.detalhe('sess-1', ATOR);

      expect(d.items[0]?.respostas).toEqual([]);
    });

    it('procura a resposta pelo personagem da PARTICIPAÇÃO, uma vez só', async () => {
      // Antes eram N consultas, uma por personagem da conta, porque a resposta
      // podia estar em qualquer um deles. Agora a participação já disse qual é.
      repo.findParticipantes.mockResolvedValue([participacao()]);

      await service.detalhe('sess-1', ATOR);

      expect(repo.findRespostasDoPersonagem).toHaveBeenCalledTimes(1);
      expect(repo.findRespostasDoPersonagem).toHaveBeenCalledWith('sess-1', 'fulano', 'azralon');
    });

    it('quem não entrou não consulta resposta nenhuma', async () => {
      await service.detalhe('sess-1', ATOR);

      expect(repo.findRespostasDoPersonagem).not.toHaveBeenCalled();
    });
  });

  describe('transições', () => {
    /** Uma sessão em deliberação com duas peças, para o encerramento. */
    const comDuasPecas = (): SessionRow => {
      const base = sessaoDoBanco({ status: 'deliberando' });
      return { ...base, items: [...base.items, { ...base.items[0]!, id: 'item-2', position: 2 }] };
    };

    it('rascunho abre', async () => {
      await service.trocarStatus('sess-1', 'aberta', ATOR);

      expect(repo.trocarStatus).toHaveBeenCalledWith('sess-1', 'rascunho', 'aberta', ATOR, true);
    });

    it('não pula etapa', async () => {
      await expect(service.trocarStatus('sess-1', 'encerrada', ATOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.trocarStatus).not.toHaveBeenCalled();
    });

    it('sessão sem item não abre', async () => {
      // Anunciar uma lista vazia faria 25 pessoas abrirem a tela para nada.
      repo.findById.mockResolvedValueOnce(sessaoDoBanco({ items: [] }));

      await expect(service.trocarStatus('sess-1', 'aberta', ATOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('não encerra com peça sem dono, e diz quantas faltam', async () => {
      // Encerrada não volta — dali sai histórico. Uma peça esquecida viraria
      // buraco permanente, e ninguém receberia erro.
      repo.findById.mockResolvedValue(comDuasPecas());
      repo.findAwards.mockResolvedValue([{ itemId: 'item-1' }]);

      await expect(service.trocarStatus('sess-1', 'encerrada', ATOR)).rejects.toThrow(
        /1 de 2 peças/,
      );
      expect(repo.trocarStatus).not.toHaveBeenCalled();
    });

    it('com tudo entregue, encerra', async () => {
      repo.findById.mockResolvedValue(comDuasPecas());
      repo.findAwards.mockResolvedValue([{ itemId: 'item-1' }, { itemId: 'item-2' }]);

      await service.trocarStatus('sess-1', 'encerrada', ATOR);

      // Não é o `repo.trocarStatus` genérico — encerrar é a transição atômica
      // com o histórico, TIT-69.
      expect(repo.trocarStatus).not.toHaveBeenCalled();
      expect(repo.encerrarComHistorico).toHaveBeenCalledWith(
        'sess-1',
        'deliberando',
        ATOR,
        expect.any(Function),
      );
    });

    describe('encerrar grava o histórico (TIT-69)', () => {
      const umAward = (over: Partial<AwardParaHistorico> = {}): AwardParaHistorico => ({
        externalId: 'item-1',
        itemId: 202612,
        itemString: MITICO,
        looterCharacterId: 'char-fulano',
        winnerCharacterId: 'char-fulano',
        responseOptionSlug: 'bis',
        votes: 3,
        councilNote: null,
        playerNote: null,
        awardedAt: new Date('2026-08-15T02:00:00.000Z'),
        awardedByUserId: 'user-1',
        awardedByBattletag: 'Loot#0001',
        ...over,
      });

      it('grava as linhas DENTRO da transação que o repositório abriu', async () => {
        repo.findById.mockResolvedValue(comDuasPecas());
        repo.findAwards.mockResolvedValue([{ itemId: 'item-1' }, { itemId: 'item-2' }]);
        repo.findAwardsParaHistorico.mockResolvedValue([umAward()]);

        await service.trocarStatus('sess-1', 'encerrada', ATOR);

        // O `encerrarComHistorico` mockado chama o callback com o FAKE_TX — se
        // este client não chegar aqui, a gravação não está mais na mesma
        // transação que o status.
        expect(lootLines.gravarDaSessao).toHaveBeenCalledWith(
          { sessionId: 'sess-1', encounterId: 'enc-kazzara', itens: [umAward()] },
          FAKE_TX,
        );
      });

      it('se a gravação das linhas falhar, a transição inteira falha', async () => {
        // `encerrarComHistorico` real é uma transação: se o callback rejeita, o
        // `$transaction` inteiro rejeita, e o status NUNCA fica encerrado sem
        // histórico. O mock espelha esse contrato repassando a rejeição.
        repo.findById.mockResolvedValue(comDuasPecas());
        repo.findAwards.mockResolvedValue([{ itemId: 'item-1' }, { itemId: 'item-2' }]);
        lootLines.gravarDaSessao.mockRejectedValueOnce(new Error('deu ruim no banco'));

        await expect(service.trocarStatus('sess-1', 'encerrada', ATOR)).rejects.toThrow(
          'deu ruim no banco',
        );
      });
    });

    describe('regerar histórico (rede de segurança, Regra 8)', () => {
      it('recusa sessão que ainda não encerrou', async () => {
        repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'deliberando' }));

        await expect(service.regerarHistorico('sess-1')).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(lootLines.gravarDaSessao).not.toHaveBeenCalled();
      });

      it('regerar duas vezes manda os MESMOS itens — a idempotência vem do externalId', async () => {
        const award: AwardParaHistorico = {
          externalId: 'item-1',
          itemId: 202612,
          itemString: MITICO,
          looterCharacterId: null,
          winnerCharacterId: 'char-fulano',
          responseOptionSlug: 'bis',
          votes: 2,
          councilNote: null,
          playerNote: null,
          awardedAt: new Date('2026-08-15T02:00:00.000Z'),
          awardedByUserId: 'user-1',
          awardedByBattletag: 'Loot#0001',
        };
        repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'encerrada' }));
        repo.findAwardsParaHistorico.mockResolvedValue([award]);

        await service.regerarHistorico('sess-1');
        await service.regerarHistorico('sess-1');

        const [primeira] = lootLines.gravarDaSessao.mock.calls[0]!;
        const [segunda] = lootLines.gravarDaSessao.mock.calls[1]!;
        expect(segunda).toEqual(primeira);
        expect(segunda.itens[0]?.externalId).toBe('item-1');
      });

      it('sem client de transação — não é uma reabertura, é operação isolada', async () => {
        repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'encerrada' }));

        await service.regerarHistorico('sess-1');

        expect(lootLines.gravarDaSessao).toHaveBeenCalledWith(expect.anything());
        expect(lootLines.gravarDaSessao.mock.calls[0]).toHaveLength(1);
      });
    });

    it('fechar a fase de roll congela o silêncio de quem estava na sessão', async () => {
      repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'aberta' }));
      repo.registrarSilencio.mockResolvedValue(3);

      await service.trocarStatus('sess-1', 'deliberando', ATOR);

      expect(repo.registrarSilencio).toHaveBeenCalledWith('sess-1', ATOR);
    });

    it('o silêncio é congelado DEPOIS da transição', async () => {
      // Antes, alguém respondendo no último instante viraria linha de `noop`
      // substituída logo em seguida — mas o log já teria dito que a pessoa não
      // respondeu.
      repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'aberta' }));
      const ordem: string[] = [];
      repo.trocarStatus.mockImplementation(() => {
        ordem.push('status');
        return Promise.resolve();
      });
      repo.registrarSilencio.mockImplementation(() => {
        ordem.push('silencio');
        return Promise.resolve(0);
      });

      await service.trocarStatus('sess-1', 'deliberando', ATOR);

      expect(ordem).toEqual(['status', 'silencio']);
    });

    it('nas outras transições, ninguém vira silêncio', async () => {
      // Abrir a sessão não fecha resposta nenhuma; encerrar acontece depois de a
      // fase de roll já ter fechado.
      await service.trocarStatus('sess-1', 'aberta', ATOR);

      expect(repo.registrarSilencio).not.toHaveBeenCalled();
    });

    it('reabrir NÃO reescreve quando a sessão foi aberta', async () => {
      // `openedAt` é quando as respostas começaram. Reabrir para uma pessoa que
      // esqueceu não pode apagar esse marco.
      repo.findById.mockResolvedValueOnce(
        sessaoDoBanco({ status: 'deliberando', openedAt: new Date('2026-08-15T01:05:00.000Z') }),
      );

      await service.trocarStatus('sess-1', 'aberta', ATOR);

      expect(repo.trocarStatus).toHaveBeenCalledWith(
        'sess-1',
        'deliberando',
        'aberta',
        ATOR,
        false,
      );
    });
  });
});
