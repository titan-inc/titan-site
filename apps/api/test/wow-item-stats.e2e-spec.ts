import '../src/load-env'; // PRIMEIRO import — PrismaService lê DATABASE_URL na construção.
import { PrismaService } from '../src/prisma/prisma.service';
import { WowDataRepository } from '../src/wow-data/wow-data.repository';
import { WowItemStatsService } from '../src/wow-data/wow-item-stats.service';

/**
 * A "prova contra o banco" da TIT-136 — o caminho independente do gerador
 * (`pnpm gerar-db2`, que lê db2 direto e fecha 208/208 contra a mesma
 * fixture). Aqui é o MESMO resolvedor de produção (`WowItemStatsService`),
 * lendo Postgres, para os espécimes da fixture que estão no catálogo hoje.
 *
 * PrismaService instanciado DIRETO — Regra 8: nunca `NestFactory`. Isto não
 * é rota de request nem processo de produção, é verificação manual (mesma
 * régua do `test:e2e` de sempre) contra o banco de dev já rodando.
 *
 * COBERTURA PARCIAL, e é esperado: TIT-142 estreitou o catálogo pra Midnight
 * S1 em diante (286 itens). Dos 25 itemIds únicos da fixture, só os que
 * estão no catálogo hoje têm `WowItemData` pra ler — os outros são temporada
 * anterior e continuam provados só pelo lado do gerador (db2 direto). Cada
 * `it.skip` abaixo documenta isso, não é lacuna deste teste.
 *
 * Exige: build ativo carregado (`pnpm gerar-db2` + `wow-data-load` +
 * `wow-data-activate`, ver `docs/ops.md`) e Postgres de dev no ar.
 */
describe('WowItemStatsService — prova contra o banco (fixture, itens catalogados)', () => {
  let prisma: PrismaService;
  let service: WowItemStatsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new WowItemStatsService(new WowDataRepository(prisma));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Bellamy's Final Judgement (249277) — arma de duas mãos", async () => {
    const r = await service.calcular(
      'item:249277:6245:::::::90:250::6:3:6652:13335:13654:1:28:3605:::::',
    );

    expect(r.indisponivel).toBeNull();
    expect(r.itemLevel).toBe(298);
    expect(r.primario).toEqual({ valor: 135, tipos: ['strength'] });
    expect(r.secundarios).toEqual(
      expect.arrayContaining([
        { nome: 'stamina', valor: 2579 },
        { nome: 'crit', valor: 51 },
        { nome: 'mastery', valor: 121 },
      ]),
    );
    expect(r.dano).toEqual({ min: 319, max: 411, dps: 101.4, velocidade: 3.6 });
    // `dificuldade` FICA DE FORA de propósito: este item tem DOIS bonus com
    // Type 4 (13335 → "Mythic", 13654 → "Ascendant Voidforged: Myth"), e
    // "o último da união vence" escolhe o segundo — a fixture nunca proveu
    // esse campo pro comparador (nem no lado do gerador), então não há
    // evidência de qual das duas strings o tooltip de verdade mostra.
    // Registrado como aberto, não resolvido aqui.
  });

  it("Radiant Clutchtender's Jerkin (249322) — indestructible calcula número, tela mostra só a palavra", async () => {
    const r = await service.calcular('item:249322::::::::90:250::6:4:43:13577:13335:12804::::::');

    expect(r.indisponivel).toBeNull();
    expect(r.itemLevel).toBe(282);
    expect(r.primario).toEqual({ valor: 116, tipos: ['agility', 'intellect'] });
    expect(r.secundarios).toEqual(
      expect.arrayContaining([
        { nome: 'stamina', valor: 2142 },
        { nome: 'crit', valor: 109 },
        { nome: 'mastery', valor: 50 },
      ]),
    );
    expect(r.terciarios).toHaveLength(1);
    expect(r.terciarios[0]?.tipo).toBe('indestructible');
    expect(r.armadura).toBe(141);
    expect(r.dificuldade).toBe('Mythic');
  });

  it('Bubblefin Splash Guard (268262) — o espécime mais importante: ilvl/track/descritor vêm da árvore, não do itemString', async () => {
    const r = await service.calcular('item:268262::::::::90:66::5:1:3524:1:28:5850:::::');

    expect(r.indisponivel).toBeNull();
    // ilvl 305 só existe se a união com WowItemContextBonus rodou — o
    // itemString tem UM bonus (3524), e ele é Type 0 (no-op). Sem a árvore,
    // isto sairia 219 (o ItemLevel base do ItemSparse) sem erro nenhum.
    expect(r.itemLevel).toBe(305);
    expect(r.armadura).toBe(1052);
    expect(r.block).toBe(2630); // floor, não round — round daria 2631.
    expect(r.secundarios).toEqual(
      expect.arrayContaining([
        { nome: 'stamina', valor: 1397 },
        { nome: 'haste', valor: 29 },
        { nome: 'mastery', valor: 60 },
        { nome: 'intellect', valor: 221 },
      ]),
    );
    // Strength (statId 4) E Intellect (statId 5) juntos no mesmo item: dois
    // candidatos a primário fixo, nenhum vence sozinho — ver o comentário de
    // `computedItemStatsSchema.primario`. O fixture (lido pelo gerador)
    // resolve por fallback pro nome declarado; aqui não há esse oráculo.
    expect(r.primario).toBeNull();
    // track/descritor TAMBÉM vêm da árvore, junto com o ilvl — o
    // itemString não carrega nenhum dos três.
    expect(r.track).toMatchObject({ nome: 'Hero', rank: 1, de: 6 });
    expect(r.dificuldade).toBe('Heroic');
  });

  it.each([
    [
      'Venomwoven Idol',
      270910,
      'item:270910::::::::90:250::5:1:3524:1:28:7363:::::',
      308,
      'bind_on_pickup',
    ],
    [
      'Venomforged Remnant',
      270925,
      'item:270925::::::::90:250::5:1:3524:1:28:7363:::::',
      308,
      'bind_on_pickup',
    ],
    [
      'Venomcured Icon',
      270927,
      'item:270927::::::::90:250::6:1:3524:1:28:7362:::::',
      324,
      'bind_on_pickup',
    ],
    [
      'Venomcast Relic',
      270920,
      'item:270920::::::::90:250::3:1:3524:1:28:7359:::::',
      298,
      'bind_on_pickup',
    ],
    [
      'Slumbering Coil Curio',
      270909,
      'item:270909::::::::90:250::5:1:3524:1:28:7363:::::',
      311,
      'bind_on_pickup',
    ],
  ] as const)(
    'não-equipamento: %s (%i) — ilvl da árvore e vínculo, sem stat nenhum',
    async (_nome, _itemId, itemString, itemLevelEsperado, vinculoEsperado) => {
      const r = await service.calcular(itemString);

      expect(r.indisponivel).toBeNull();
      expect(r.itemLevel).toBe(itemLevelEsperado);
      expect(r.vinculo).toBe(vinculoEsperado);
      expect(r.primario).toBeNull();
      expect(r.armadura).toBeNull();
    },
  );

  it("Hex Lord's Visage (275937) — bit 27 do Flags vence o Bonding: Binds to Warband", async () => {
    const r = await service.calcular('item:275937::::::::90:250::3:1:3524:1:28:7359:::::');

    expect(r.indisponivel).toBeNull();
    expect(r.vinculo).toBe('warband');
  });

  it('"Rage of the Shackled" Mural (279500) — mesma regra de vínculo, ilvl base (a árvore não devolve nada no ctx 5)', async () => {
    const r = await service.calcular('item:279500::::::::90:250::5:1:3524:1:28:7363:::::');

    expect(r.indisponivel).toBeNull();
    expect(r.vinculo).toBe('warband');
    expect(r.itemLevel).toBe(1); // o base do ItemSparse — a árvore não dá ilvl neste ctx.
  });

  /**
   * Os outros 15 itemIds únicos da fixture (Relentless Rider's Chain,
   * Pendant of Malefic Fury, Blazebinder's Hoof, Steelbark Shoulderguards,
   * Ancient Amani Greataxe, Beakbreaker Scimitar, os dois Tarnished Dawnlit,
   * Bramblebarricade, Luminant Verdict's Divine Warplate, Devouring
   * Reaver's Essence Grips, Pyrewalker's Doublet, Platinum Star Band) são
   * de temporada anterior a Midnight S1 e não estão no catálogo (TIT-142) —
   * sem `WowItem`, não existe `WowItemData` pra ler. Provados só pelo lado
   * do gerador (`pnpm gerar-db2`, 208/208 contra db2 direto).
   */
  it.skip('itens fora do catálogo atual — cobertos só pelo gerador, não pelo banco', () => {});
});
