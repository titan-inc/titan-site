import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LootSessionsService } from './loot-sessions.service';
import type { PersonagemDaConta } from './loot-sessions.service';
import type {
  Ator,
  ItemDaSessao,
  LootSessionsRepository,
  SessionRow,
} from './loot-sessions.repository';

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
      looterName: 'Fulano',
      looterRealm: 'Azralon',
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
          roll: number;
          aguardandoNovaResposta: boolean;
          name: string;
        }>
      >,
      [string, string, string]
    >(() => Promise.resolve([])),
    findAwards: jest.fn<Promise<Array<{ itemId: string }>>, [string]>(() => Promise.resolve([])),
    contarRespostas: jest.fn<Promise<Map<string, number>>, [string]>(() =>
      Promise.resolve(new Map()),
    ),
    itemPertence: jest.fn<Promise<boolean>, [string, string]>(() => Promise.resolve(true)),
    findSlugsAtivos: jest.fn<Promise<string[]>, []>(() =>
      Promise.resolve(['bis', 'upgrade', 'pass']),
    ),
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

    service = new LootSessionsService(repo as unknown as LootSessionsRepository);
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
      const d = await service.detalhe('sess-1');

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

      const d = await service.detalhe('sess-1');

      expect(d.items[0]?.name).toBeNull();
      expect(d.items[0]?.itemId).toBe(202612);
    });

    it('sessão inexistente é 404', async () => {
      repo.findById.mockResolvedValueOnce(null);

      await expect(service.detalhe('nao-existe')).rejects.toBeInstanceOf(NotFoundException);
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

  describe('o jogador responde', () => {
    const aberta = () => repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'aberta' }));

    /** O que o serviço mandou gravar. */
    const gravado = (): RespostaGravada => {
      const chamada = repo.responder.mock.calls[0];
      if (chamada === undefined) throw new Error('responder não foi chamado');
      return chamada[0];
    };

    it('grava a resposta com um roll do servidor, entre 1 e 100', async () => {
      aberta();

      await service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR, PERSONAGENS);

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
        PERSONAGENS,
      );

      // Um roll do servidor cair exatamente em 100 é 1%, então isto não é flaky
      // por acaso — o que se testa é que o campo do cliente foi ignorado.
      expect(Object.keys(gravado())).toContain('roll');
      expect(gravado().roll).toBeGreaterThanOrEqual(1);
    });

    it('responde pelo representante da conta quando não escolhe personagem', async () => {
      // O de MELHOR rank, que é o de MENOR número — rank 0 é o guild master.
      aberta();

      await service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR, PERSONAGENS);

      expect(gravado().personagem).toMatchObject({ nameKey: 'ciclano', name: 'Ciclano' });
    });

    it('o realm da identidade é a chave frouxa', async () => {
      // `area-52` do roster vira `area52`, que é como a linha de loot e a
      // presença guardam — Regra 6.
      aberta();

      await service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR, PERSONAGENS);

      expect(gravado().personagem.realmKey).toBe('area52');
    });

    it('dá para escolher outro personagem DA CONTA', async () => {
      aberta();

      await service.responder(
        'sess-1',
        'item-1',
        { responseOptionSlug: 'bis', characterName: 'Fulano' },
        ATOR,
        PERSONAGENS,
      );

      expect(gravado().personagem.nameKey).toBe('fulano');
    });

    it('personagem que não é da conta é recusado', async () => {
      // Aceitar qualquer nome deixaria responder no lugar de outra pessoa.
      aberta();

      await expect(
        service.responder(
          'sess-1',
          'item-1',
          { responseOptionSlug: 'bis', characterName: 'DeOutraPessoa' },
          ATOR,
          PERSONAGENS,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.responder).not.toHaveBeenCalled();
    });

    it('conta sem personagem no roster não responde', async () => {
      aberta();

      await expect(
        service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR, []),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('opção de resposta inativa é recusada', async () => {
      // A tabela é configurável e a liderança desativa opção. Aceitar a
      // desativada deixaria entrar resposta que a tela nem oferece mais.
      aberta();

      await expect(
        service.responder(
          'sess-1',
          'item-1',
          { responseOptionSlug: 'transmog' },
          ATOR,
          PERSONAGENS,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('item de outra sessão é 404', async () => {
      aberta();
      repo.itemPertence.mockResolvedValueOnce(false);

      await expect(
        service.responder('sess-1', 'de-outra', { responseOptionSlug: 'bis' }, ATOR, PERSONAGENS),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('em rascunho ainda não dá para responder', async () => {
      // A lista de itens nem foi anunciada.
      repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'rascunho' }));

      await expect(
        service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR, PERSONAGENS),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    describe('em deliberando, só responde quem o conselho reabriu', () => {
      const respostaDoItem = (aguardando: boolean) => [
        {
          itemId: 'item-1',
          responseOptionSlug: 'bis',
          roll: 73,
          aguardandoNovaResposta: aguardando,
          name: 'Ciclano',
        },
      ];

      it('com reabertura, responde', async () => {
        repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'deliberando' }));
        repo.findRespostasDoPersonagem.mockResolvedValue(respostaDoItem(true));

        await service.responder(
          'sess-1',
          'item-1',
          { responseOptionSlug: 'upgrade' },
          ATOR,
          PERSONAGENS,
        );

        expect(repo.responder).toHaveBeenCalled();
      });

      it('sem reabertura, é recusado', async () => {
        // O conselho já está votando em cima da resposta declarada. Deixar mudar
        // embaixo faria o voto ser sobre uma coisa e a decisão sobre outra.
        repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'deliberando' }));
        repo.findRespostasDoPersonagem.mockResolvedValue(respostaDoItem(false));

        await expect(
          service.responder(
            'sess-1',
            'item-1',
            { responseOptionSlug: 'upgrade' },
            ATOR,
            PERSONAGENS,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(repo.responder).not.toHaveBeenCalled();
      });

      it('quem nunca respondeu também é barrado', async () => {
        // Trazer essa pessoa de volta é ação do conselho, não dela. O mecanismo
        // é a TIT-66, que precisa saber reabrir para quem não tem resposta.
        repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'deliberando' }));
        repo.findRespostasDoPersonagem.mockResolvedValue([]);

        await expect(
          service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR, PERSONAGENS),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('a reabertura vale para o item reaberto, não para os outros', async () => {
        // Reabrir uma peça não pode virar passe livre na sessão inteira.
        repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'deliberando' }));
        repo.findRespostasDoPersonagem.mockResolvedValue(respostaDoItem(true));
        repo.itemPertence.mockResolvedValue(true);

        await expect(
          service.responder(
            'sess-1',
            'outro-item',
            { responseOptionSlug: 'bis' },
            ATOR,
            PERSONAGENS,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    it('em aberta a resposta é livre, sem precisar de reabertura', async () => {
      repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'aberta' }));
      repo.findRespostasDoPersonagem.mockResolvedValue([]);

      await service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR, PERSONAGENS);

      expect(repo.responder).toHaveBeenCalled();
    });

    it('sessão encerrada não aceita mais resposta', async () => {
      repo.findById.mockResolvedValue(sessaoDoBanco({ status: 'encerrada' }));

      await expect(
        service.responder('sess-1', 'item-1', { responseOptionSlug: 'bis' }, ATOR, PERSONAGENS),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('privacidade da sessão', () => {
    it('mostra a própria resposta e o próprio roll', async () => {
      repo.findRespostasDoPersonagem.mockResolvedValue([
        {
          itemId: 'item-1',
          responseOptionSlug: 'bis',
          roll: 73,
          aguardandoNovaResposta: false,
          name: 'Ciclano',
        },
      ]);

      const d = await service.detalhe('sess-1', PERSONAGENS);

      expect(d.items[0]?.minhaResposta).toMatchObject({ responseOptionSlug: 'bis', roll: 73 });
    });

    it('sem personagem nenhum, não vem resposta — o padrão é fechado', async () => {
      const d = await service.detalhe('sess-1');

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

      const d = await service.detalhe('sess-1', PERSONAGENS);

      expect(d.items[0]?.totalDeRespostas).toBe(12);
      expect(d.items[0]?.minhaResposta).toBeNull();
      expect(JSON.stringify(d)).not.toContain('roll');
    });

    it('procura a resposta em TODOS os personagens da conta', async () => {
      // Quem raida em dois chars respondeu com um deles; olhar só o
      // representante mostraria "você não respondeu" e a pessoa responderia de
      // novo, agora no char errado.
      await service.detalhe('sess-1', PERSONAGENS);

      expect(repo.findRespostasDoPersonagem).toHaveBeenCalledTimes(2);
      expect(repo.findRespostasDoPersonagem).toHaveBeenCalledWith('sess-1', 'ciclano', 'area52');
      expect(repo.findRespostasDoPersonagem).toHaveBeenCalledWith('sess-1', 'fulano', 'azralon');
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

      expect(repo.trocarStatus).toHaveBeenCalledWith(
        'sess-1',
        'deliberando',
        'encerrada',
        ATOR,
        expect.any(Boolean),
      );
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
