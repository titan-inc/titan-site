// Antes do import do serviço: o construtor dele chama `loadGuildConfig()`, que
// lança sem estas. Mesmo arranjo do `attendance.service.spec.ts`.
process.env.GUILD_NAME = 'Guilda de Teste';
process.env.GUILD_REALM = 'Realm de Teste';
process.env.GUILD_TIMEZONE = 'America/Sao_Paulo';

import type { Prisma } from '@prisma/client';
import { lootHistoryQuerySchema, RAID_DIFFICULTIES } from '@titan/shared';
import { LootHistoryService } from './loot-history.service';
import type { CatalogItemRow, LootHistoryRow, LootLinesRepository } from './loot-lines.repository';

/**
 * Uma linha como o `select` do repositório devolve. Nomes fictícios de
 * propósito — o histórico real tem gente de verdade e o repo é público.
 */
const linhaDoBanco = (over: Partial<LootHistoryRow> = {}): LootHistoryRow => ({
  id: 'ckline',
  awardedAt: new Date('2026-03-19T23:12:00.000Z'),
  winnerNameKey: 'fulano',
  winnerRealmKey: 'area52',
  winnerName: 'Fulano',
  winnerRealm: 'Area52',
  winnerClass: 'MAGE',
  itemId: 249308,
  rawBoss: 'Chimaerus, the Undreamt God',
  rawInstance: 'The Voidspire-Heroic',
  difficulty: RAID_DIFFICULTIES.HEROIC,
  votes: 2,
  note: null,
  encounter: { id: 'enc-1', name: 'Chimaerus the Undreamt God', raid: { name: 'The Voidspire' } },
  responseOption: { slug: 'bis', label: 'BiS' },
  ...over,
});

const item = (over: Partial<CatalogItemRow> = {}): CatalogItemRow => ({
  itemId: 249308,
  name: 'Despotic Raiment',
  icon: 'inv_helm_plate_raid_01',
  equipLoc: 'HEAD',
  ...over,
});

/** Os filtros já passados pelo schema, como o controller entrega. */
const filtros = (bruto: Record<string, unknown> = {}) => lootHistoryQuerySchema.parse(bruto);

describe('LootHistoryService', () => {
  const repo = {
    // Os argumentos vão no genérico do `jest.fn` para o `mock.calls` vir tipado
    // — é por ele que os testes de filtro conferem o `where` montado.
    findHistoryPage: jest.fn<
      Promise<{ linhas: LootHistoryRow[]; total: number }>,
      [Prisma.LootLineWhereInput, number, number]
    >(() => Promise.resolve({ linhas: [linhaDoBanco()], total: 1 })),
    findItems: jest.fn<Promise<CatalogItemRow[]>, [number[]]>(() => Promise.resolve([item()])),
    findItemIdsBySlot: jest.fn<Promise<number[]>, [string]>(() => Promise.resolve([249308])),
  };

  let service: LootHistoryService;

  /**
   * O `where` que o serviço montou.
   *
   * Estoura se o repositório não foi chamado, em vez de devolver `undefined` e
   * fazer a asserção seguinte passar por vacuidade.
   */
  const whereUsado = (): Prisma.LootLineWhereInput => {
    const chamada = repo.findHistoryPage.mock.calls[0];
    if (chamada === undefined) throw new Error('findHistoryPage não foi chamado');
    return chamada[0];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LootHistoryService(repo as unknown as LootLinesRepository);
  });

  describe('filtros', () => {
    it('sem filtro nenhum não restringe nada', async () => {
      await service.consultar(filtros());

      expect(whereUsado()).toEqual({});
    });

    it('personagem vira a identidade normalizada, não a string crua', async () => {
      // `Area52` da fonte precisa casar com `area-52` do roster: o realm vai
      // pela chave frouxa. O nome mantém acento, que é o que distingue pessoas.
      await service.consultar(filtros({ character: 'Shrëwd-Area52' }));

      expect(whereUsado()).toMatchObject({ winnerNameKey: 'shrëwd', winnerRealmKey: 'area52' });
    });

    it('personagem sem realm é ignorado em vez de recusar a consulta', async () => {
      // Nome sozinho não identifica ninguém (Regra 6). Barrar a tela inteira por
      // causa de um campo mal preenchido é pior que mostrar tudo.
      await service.consultar(filtros({ character: 'Fulano' }));

      expect(whereUsado()).toEqual({});
    });

    it('a janela é no fuso da guilda, não em UTC', async () => {
      // NÃO é cosmético: a raid começa 21:00 BRT, que já é o dia seguinte em
      // UTC. Das 294 entregas importadas, todas caem entre 00:33 e 02:40 UTC —
      // nenhuma está no dia UTC em que a raid aconteceu. Em UTC, filtrar a noite
      // de 17/03 devolveria zero.
      //
      // America/Sao_Paulo é -03:00 fixo desde 2019, então meia-noite local é
      // 03:00 UTC do mesmo dia.
      await service.consultar(filtros({ from: '2026-03-17', to: '2026-03-19' }));

      expect(whereUsado().awardedAt).toEqual({
        gte: new Date('2026-03-17T03:00:00.000Z'),
        lte: new Date('2026-03-20T02:59:59.999Z'),
      });
    });

    it('o fim do dia local cobre a noite inteira de raid', async () => {
      // A entrega de 01:02 UTC de 18/03 pertence à noite de 17/03 no fuso da
      // guilda. Pedir só o dia 17 tem que alcançá-la.
      await service.consultar(filtros({ from: '2026-03-17', to: '2026-03-17' }));

      const janela = whereUsado().awardedAt as { gte: Date; lte: Date };
      const entregaDaNoite = new Date('2026-03-18T01:02:47.000Z');

      expect(entregaDaNoite >= janela.gte && entregaDaNoite <= janela.lte).toBe(true);
    });

    it('slot vira lista de itemId', async () => {
      await service.consultar(filtros({ slot: 'HEAD' }));

      expect(repo.findItemIdsBySlot).toHaveBeenCalledWith('HEAD');
      expect(whereUsado().itemId).toEqual({ in: [249308] });
    });

    it('slot sem item no catálogo devolve vazio, não tudo', async () => {
      // O erro que este teste tranca: ignorar o filtro quando ele não casa nada
      // faria a tela mostrar o histórico inteiro como se fosse o resultado.
      repo.findItemIdsBySlot.mockResolvedValueOnce([]);

      await service.consultar(filtros({ slot: 'TABARD' }));

      expect(whereUsado().itemId).toEqual({ in: [-1] });
    });

    it('boss e dificuldade passam direto', async () => {
      await service.consultar(filtros({ encounterId: 'enc-1', difficulty: 'mythic' }));

      expect(whereUsado()).toMatchObject({ encounterId: 'enc-1', difficulty: 'mythic' });
    });
  });

  describe('a entrada montada', () => {
    it('o nome do item vem do catálogo', async () => {
      const pagina = await service.consultar(filtros());

      expect(pagina.entries[0]?.item).toEqual({
        itemId: 249308,
        name: 'Despotic Raiment',
        icon: 'inv_helm_plate_raid_01',
        equipLoc: 'HEAD',
      });
    });

    it('item que o catálogo não tem fica sem nome, e a linha entra assim mesmo', async () => {
      // Catálogo atrasado não pode barrar histórico. E nome nulo é melhor que o
      // `itemName` da fonte, que vem no idioma do loot master da noite.
      repo.findItems.mockResolvedValueOnce([]);

      const pagina = await service.consultar(filtros());

      expect(pagina.entries[0]?.item.name).toBeNull();
      expect(pagina.entries[0]?.id).toBe('ckline');
    });

    it('boss resolvido usa o nome do catálogo', async () => {
      const pagina = await service.consultar(filtros());

      expect(pagina.entries[0]?.boss).toEqual({
        encounterId: 'enc-1',
        name: 'Chimaerus the Undreamt God',
        raid: 'The Voidspire',
      });
    });

    it('boss não resolvido cai para a grafia da fonte', async () => {
      // 26% do histórico. Mostrar vazio esconderia a única pista que existe.
      repo.findHistoryPage.mockResolvedValueOnce({
        linhas: [linhaDoBanco({ encounter: null, rawBoss: 'Desconhecido' })],
        total: 1,
      });

      const pagina = await service.consultar(filtros());

      expect(pagina.entries[0]?.boss).toEqual({
        encounterId: null,
        name: 'Desconhecido',
        raid: 'The Voidspire-Heroic',
      });
    });

    it('a resposta traz slug e label juntos', async () => {
      const pagina = await service.consultar(filtros());

      expect(pagina.entries[0]?.response).toEqual({ slug: 'bis', label: 'BiS' });
    });
  });

  describe('paginação', () => {
    it('devolve página e tamanho junto do total filtrado', async () => {
      repo.findHistoryPage.mockResolvedValueOnce({ linhas: [linhaDoBanco()], total: 37 });

      const pagina = await service.consultar(filtros({ page: '2', pageSize: '10' }));

      expect(pagina).toMatchObject({ total: 37, page: 2, pageSize: 10 });
      expect(repo.findHistoryPage).toHaveBeenCalledWith(expect.anything(), 2, 10);
    });

    it('não consulta item nenhum quando a página é vazia', async () => {
      repo.findHistoryPage.mockResolvedValueOnce({ linhas: [], total: 0 });

      const pagina = await service.consultar(filtros({ page: '99' }));

      expect(pagina.entries).toEqual([]);
      expect(repo.findItems).not.toHaveBeenCalled();
    });

    it('pede cada item uma vez só, mesmo repetido na página', async () => {
      repo.findHistoryPage.mockResolvedValueOnce({
        linhas: [linhaDoBanco(), linhaDoBanco({ id: 'ckline2' })],
        total: 2,
      });

      await service.consultar(filtros());

      expect(repo.findItems).toHaveBeenCalledWith([249308]);
    });
  });
});

describe('lootHistoryQuerySchema', () => {
  it('tem padrão de página, para a tela de entrada não precisar mandar nada', () => {
    expect(filtros()).toMatchObject({ page: 1, pageSize: 50 });
  });

  it('recusa pageSize acima do teto', () => {
    // Sem teto, uma query solta varre o histórico inteiro numa resposta só.
    expect(lootHistoryQuerySchema.safeParse({ pageSize: '5000' }).success).toBe(false);
  });

  it('recusa dificuldade fora do vocabulário', () => {
    expect(lootHistoryQuerySchema.safeParse({ difficulty: 'mitico' }).success).toBe(false);
  });

  it('recusa data que não é data', () => {
    expect(lootHistoryQuerySchema.safeParse({ from: '19/03/2026' }).success).toBe(false);
  });
});
