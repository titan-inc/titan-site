import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LootSessionsService } from './loot-sessions.service';
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
  };

  let service: LootSessionsService;

  /** Os itens que o serviço mandou gravar na criação. */
  const itensGravados = (): ItemDaSessao[] => {
    const chamada = repo.criar.mock.calls[0];
    if (chamada === undefined) throw new Error('criar não foi chamado');
    return chamada[0].itens;
  };

  beforeEach(() => {
    jest.clearAllMocks();
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

  describe('transições', () => {
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
