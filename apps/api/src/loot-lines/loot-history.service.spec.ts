// Antes do import do serviço: o construtor dele chama `loadGuildConfig()`, que
// lança sem estas. Mesmo arranjo do `attendance.service.spec.ts`.
process.env.GUILD_NAME = 'Guilda de Teste';
process.env.GUILD_REALM = 'Realm de Teste';
process.env.GUILD_TIMEZONE = 'America/Sao_Paulo';

import type { Prisma } from '@prisma/client';
import {
  ITEM_STATS_INDISPONIVEL,
  itemStatsIndisponivel,
  lootHistoryQuerySchema,
  RAID_DIFFICULTIES,
  type ComputedItemStats,
} from '@titan/shared';
import type { WowItemStatsService } from '../wow-data/wow-item-stats.service';
import { LootHistoryService } from './loot-history.service';
import type { CatalogItemRow, LootHistoryRow, LootLinesRepository } from './loot-lines.repository';

/** O `itemString` padrão da fixture — só precisa ser uma chave estável para
 * o `Map` que o `WowItemStatsService` dublado devolve, nunca é de fato
 * parseado nestes testes (quem prova o parse é `wow-item-stats.service.spec.ts`). */
const ITEM_STRING = 'item:249308::::::::90:250::35:0:';

/**
 * Uma linha como o `select` do repositório devolve. Nomes fictícios de
 * propósito — o histórico real tem gente de verdade e o repo é público.
 */
const linhaDoBanco = (over: Partial<LootHistoryRow> = {}): LootHistoryRow => ({
  id: 'ckline',
  awardedAt: new Date('2026-03-19T23:12:00.000Z'),
  winner: {
    id: 'char-fulano',
    nameKey: 'fulano',
    realmKey: 'area52',
    name: 'Fulano',
    realm: 'Area52',
    class: 'MAGE',
  },
  itemId: 249308,
  itemString: ITEM_STRING,
  difficulty: RAID_DIFFICULTIES.HEROIC,
  votes: 2,
  playerNote: null,
  responseKind: 'player',
  encounter: { id: 'enc-1', name: 'Chimaerus the Undreamt God', raid: { name: 'The Voidspire' } },
  responseOption: { slug: 'bis', label: 'BiS' },
  ...over,
});

const item = (over: Partial<CatalogItemRow> = {}): CatalogItemRow => ({
  itemId: 249308,
  name: 'Despotic Raiment',
  icon: 'inv_helm_plate_raid_01',
  equipLoc: 'HEAD',
  itemSubclass: null,
  ...over,
});

/**
 * O `ComputedItemStats` padrão dublado — LACUNA explícita (`sem_build_ativo`,
 * o formato vazio canônico), não um cálculo inventado. Estes testes provam
 * `LootHistoryService`, não o cálculo em si — quem preenche stat de verdade é
 * `wow-item-stats.service.spec.ts`.
 */
const computado = (): ComputedItemStats =>
  itemStatsIndisponivel(ITEM_STATS_INDISPONIVEL.SEM_BUILD_ATIVO);

function montarWowItemStats() {
  return {
    calcularVarios: jest.fn<Promise<Map<string, ComputedItemStats>>, [string[]]>((itemStrings) =>
      Promise.resolve(new Map(itemStrings.map((s) => [s, computado()]))),
    ),
    trackScalingIdAtual: jest.fn<Promise<number | null>, []>(() => Promise.resolve(null)),
  };
}

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
    findCharacterByKeys: jest.fn<Promise<{ id: string } | null>, [string, string]>(() =>
      Promise.resolve({ id: 'char-shrewd' }),
    ),

    contarPorSeason: jest.fn(() =>
      Promise.resolve([
        { seasonId: 17, _count: 294 },
        { seasonId: null, _count: 3 },
      ]),
    ),
    findSeasonNames: jest.fn<Promise<Array<{ id: number; name: string }>>, [number[]]>(() =>
      Promise.resolve([{ id: 17, name: 'Mythic+ Dungeons (Midnight Season 1)' }]),
    ),
    contarPorPersonagem: jest.fn(() =>
      Promise.resolve([
        {
          winnerNameKey: 'fulano',
          winnerRealmKey: 'area52',
          winnerName: 'Fulano',
          winnerRealm: 'Area52',
          _count: 19,
        },
        {
          winnerNameKey: 'beltrano',
          winnerRealmKey: 'azralon',
          winnerName: 'Beltrano',
          winnerRealm: 'Azralon',
          _count: 4,
        },
      ]),
    ),
    contarPorBoss: jest.fn(() => Promise.resolve([{ encounterId: 'enc-1', _count: 12 }])),
    findEncounterLabels: jest.fn(() =>
      Promise.resolve([
        { id: 'enc-1', name: 'Chimaerus the Undreamt God', raid: { name: 'The Voidspire' } },
      ]),
    ),
    contarPorItem: jest.fn(() => Promise.resolve([{ itemId: 249308, _count: 7 }])),
  };

  const wowItemStats = montarWowItemStats();

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
    service = new LootHistoryService(
      repo as unknown as LootLinesRepository,
      wowItemStats as unknown as WowItemStatsService,
    );
  });

  describe('filtros', () => {
    it('sem filtro nenhum não restringe nada', async () => {
      await service.consultar(filtros());

      expect(whereUsado()).toEqual({});
    });

    it('personagem vira a identidade normalizada, não a string crua', async () => {
      // `Area52` da fonte precisa casar com `area-52` do roster: o realm vai
      // pela chave frouxa. O nome mantém acento, que é o que distingue pessoas.
      // `Nome-Realm` na URL vira identidade aqui — quem resolve é o repositório.
      await service.consultar(filtros({ character: 'Shrëwd-Area52' }));

      expect(repo.findCharacterByKeys).toHaveBeenCalledWith('shrëwd', 'area52');
      expect(whereUsado()).toMatchObject({ winnerCharacterId: 'char-shrewd' });
    });

    it('personagem filtra só o que ele RECEBEU, não linha de banking em nome dele', async () => {
      // "Histórico desta pessoa" é responseKind = player. Sem isso, quem
      // guardou uma peça no banco apareceria como se tivesse recebido.
      await service.consultar(filtros({ character: 'Fulano-Area52' }));

      expect(whereUsado()).toMatchObject({ responseKind: 'player' });
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

    it('season filtra, e ausente significa todas', async () => {
      await service.consultar(filtros({ season: '17' }));
      expect(whereUsado()).toMatchObject({ seasonId: 17 });

      jest.clearAllMocks();
      await service.consultar(filtros());
      expect(whereUsado().seasonId).toBeUndefined();
    });
  });

  describe('a entrada montada', () => {
    it('o nome do item vem do catálogo', async () => {
      const pagina = await service.consultar(filtros());

      expect(pagina.entries[0]?.item).toEqual({
        itemId: 249308,
        itemString: ITEM_STRING,
        name: 'Despotic Raiment',
        icon: 'inv_helm_plate_raid_01',
        equipLoc: 'HEAD',
        itemSubclass: null,
        ...computado(),
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

    it('boss não resolvido vira lacuna, sem fallback para bruto de outra ferramenta', async () => {
      // Desde a TIT-130 não há mais rawBoss/rawInstance na linha: nulo é a
      // lacuna honesta, e não o texto interno do RCLootCouncil com cara de
      // dado nosso.
      repo.findHistoryPage.mockResolvedValueOnce({
        linhas: [linhaDoBanco({ encounter: null })],
        total: 1,
      });

      const pagina = await service.consultar(filtros());

      expect(pagina.entries[0]?.boss).toEqual({ encounterId: null, name: null, raid: null });
    });

    it('a resposta traz slug e label juntos', async () => {
      const pagina = await service.consultar(filtros());

      expect(pagina.entries[0]?.response).toEqual({ slug: 'bis', label: 'BiS' });
    });

    it('o responseKind é o CONGELADO da linha, não o da opção hoje', async () => {
      // É o que a tela usa para ler "foi para o banco, guardado por X" em vez
      // de "X levou" numa linha de loot_master.
      repo.findHistoryPage.mockResolvedValueOnce({
        linhas: [linhaDoBanco({ responseKind: 'loot_master' })],
        total: 1,
      });

      const pagina = await service.consultar(filtros());

      expect(pagina.entries[0]?.responseKind).toBe('loot_master');
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

describe('LootHistoryService.facets', () => {
  const repo = {
    contarPorSeason: jest.fn(() =>
      Promise.resolve([
        { seasonId: 17, _count: 294 },
        { seasonId: 18, _count: 5 },
        { seasonId: null, _count: 3 },
      ]),
    ),
    findSeasonNames: jest.fn<Promise<Array<{ id: number; name: string }>>, [number[]]>(() =>
      Promise.resolve([
        { id: 17, name: 'Midnight Season 1' },
        { id: 18, name: 'Midnight Season 2' },
      ]),
    ),
    contarPorPersonagem: jest.fn(() =>
      Promise.resolve([
        { winnerCharacterId: 'char-zulu', _count: 4 },
        { winnerCharacterId: 'char-alfa', _count: 19 },
      ]),
    ),
    findCharacterNames: jest.fn<
      Promise<Array<{ id: string; name: string; realm: string }>>,
      [string[]]
    >(() =>
      Promise.resolve([
        { id: 'char-zulu', name: 'Zulu', realm: 'Azralon' },
        { id: 'char-alfa', name: 'Alfa', realm: 'Area52' },
      ]),
    ),
    contarPorBoss: jest.fn(() =>
      Promise.resolve([
        { encounterId: 'enc-1', _count: 12 },
        { encounterId: 'enc-sumido', _count: 2 },
      ]),
    ),
    findEncounterLabels: jest.fn(() =>
      Promise.resolve([
        { id: 'enc-1', name: 'Chimaerus the Undreamt God', raid: { name: 'The Voidspire' } },
      ]),
    ),
    contarPorItem: jest.fn(() =>
      Promise.resolve([
        { itemId: 1, _count: 7 },
        { itemId: 2, _count: 3 },
        { itemId: 99, _count: 5 },
      ]),
    ),
    findItems: jest.fn<Promise<CatalogItemRow[]>, [number[]]>(() =>
      Promise.resolve([
        { itemId: 1, name: 'A', icon: null, equipLoc: 'HEAD', itemSubclass: null },
        { itemId: 2, name: 'B', icon: null, equipLoc: 'HEAD', itemSubclass: null },
        // 99 fica de fora do catálogo de propósito.
      ]),
    ),
  };

  // `facets()` não chama `WowItemStatsService` — só `consultar()` chama.
  // Dublê sem comportamento, só para o construtor aceitar.
  const wowItemStats = montarWowItemStats();

  let service: LootHistoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LootHistoryService(
      repo as unknown as LootLinesRepository,
      wowItemStats as unknown as WowItemStatsService,
    );
  });

  it('a lista de seasons ignora a season selecionada', async () => {
    // É o seletor de season: precisa oferecer para onde ir, não só onde se está.
    await service.facets(17);

    expect(repo.contarPorSeason).toHaveBeenCalledWith();
    const f = await service.facets(17);
    expect(f.seasons.map((s) => s.id)).toEqual([18, 17, null]);
  });

  it('a fatia sem season aparece rotulada, e por último', async () => {
    // Esconder deixaria entregas fora de qualquer filtro — lacuna invisível.
    const f = await service.facets(undefined);

    expect(f.seasons.at(-1)).toEqual({ id: null, name: 'Sem season', total: 3 });
  });

  it('season que sumiu da tabela mostra o id em vez de esconder o histórico', async () => {
    repo.findSeasonNames.mockResolvedValueOnce([{ id: 17, name: 'Midnight Season 1' }]);

    const f = await service.facets(undefined);

    expect(f.seasons.find((s) => s.id === 18)?.name).toBe('Season 18');
  });

  it('personagens saem ordenados por nome, com o valor pronto para o filtro', async () => {
    const f = await service.facets(17);

    expect(f.characters).toEqual([
      { name: 'Alfa', realm: 'Area52', value: 'Alfa-Area52', total: 19 },
      { name: 'Zulu', realm: 'Azralon', value: 'Zulu-Azralon', total: 4 },
    ]);
  });

  it('a faceta de personagem conta só o que foi RECEBIDO, não banking', async () => {
    // Mesma régua do filtro por personagem: sem isto, um banker apareceria no
    // seletor com contagem que não bate com o que a lista mostra ao clicar.
    await service.facets(17);

    expect(repo.contarPorPersonagem).toHaveBeenCalledWith(
      expect.objectContaining({ seasonId: 17, responseKind: 'player' }),
    );
  });

  it('boss sem rótulo no catálogo não vira opção', async () => {
    // Oferecer um filtro cujo nome não sabemos mostrar seria opção em branco.
    const f = await service.facets(17);

    expect(f.bosses).toEqual([
      {
        encounterId: 'enc-1',
        name: 'Chimaerus the Undreamt God',
        raid: 'The Voidspire',
        total: 12,
      },
    ]);
  });

  it('slot soma as entregas dos itens daquele slot', async () => {
    // 7 + 3 do HEAD; o item 99 não está no catálogo e não tem slot a oferecer.
    const f = await service.facets(17);

    expect(f.slots).toEqual([{ equipLoc: 'HEAD', total: 10 }]);
  });

  it('histórico vazio devolve listas vazias, sem consultar rótulo à toa', async () => {
    repo.contarPorPersonagem.mockResolvedValueOnce([]);
    repo.contarPorBoss.mockResolvedValueOnce([]);
    repo.contarPorItem.mockResolvedValueOnce([]);

    const f = await service.facets(18);

    expect(f).toMatchObject({ characters: [], bosses: [], slots: [] });
    expect(repo.findEncounterLabels).not.toHaveBeenCalled();
    expect(repo.findItems).not.toHaveBeenCalled();
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
