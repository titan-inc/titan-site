import {
  PRIMARY_STATS,
  RAID_DIFFICULTIES,
  type CatalogFile,
  type CatalogFileBoss,
  type CatalogFileItem,
  type JournalDump,
} from '@titan/shared';
import type { BlizzardService, JournalEncounter } from '../blizzard/blizzard.service';
import type {
  RaidCatalog,
  RaidEncounter,
  WarcraftLogsService,
} from '../warcraftlogs/warcraftlogs.service';
import { LootCatalogGeneratorService } from './loot-catalog-generator.service';

/** Boss do catálogo do WCL. A zona só importa para o espelho de PTR/Beta. */
const encounter = (id: number, name: string, zoneId = 46): RaidEncounter => ({
  id,
  name,
  zoneId,
  zoneName: `zona ${zoneId}`,
  order: 0,
});

const catalogo = (bosses: RaidEncounter[]): RaidCatalog => ({
  encounters: new Map(bosses.map((b) => [b.id, b])),
  zones: new Map(),
  difficultyNames: new Map(),
});

/** Encontro do journal, com as três dificuldades e um item. */
const encontro = (id: number, name: string, over: Partial<JournalEncounter> = {}) =>
  ({
    id,
    name,
    modes: [
      { type: 'NORMAL', name: 'Normal' },
      { type: 'HEROIC', name: 'Heroic' },
      { type: 'MYTHIC', name: 'Mythic' },
    ],
    items: [{ item: { id: 100, name: 'Peça' } }],
    ...over,
  }) satisfies JournalEncounter;

interface Cenario {
  /** Bosses da raid, na ordem do journal. */
  journal: JournalEncounter[];
  /** O que o WCL conhece. */
  wcl: RaidEncounter[];
  /** itemId → resposta da API de item. */
  itens?: Record<number, Record<string, unknown>>;
  /** `map` da instância, de onde sai o `instanceMapId`. */
  map?: { id: number; name: string };
}

function montar(cenario: Cenario) {
  const getItem = jest.fn((id: number) =>
    Promise.resolve({ id, name: `Item ${id}`, ...(cenario.itens?.[id] ?? {}) }),
  );
  const getItemIcon = jest.fn(() => Promise.resolve('inv-icone'));

  const blizzard = {
    getJournalInstance: () =>
      Promise.resolve({
        id: 1307,
        name: 'The Voidspire',
        encounters: cenario.journal.map((e) => ({ id: e.id, name: e.name })),
        ...(cenario.map ? { map: cenario.map } : {}),
      }),
    getJournalEncounter: (id: number) => {
      const achado = cenario.journal.find((e) => e.id === id);
      if (!achado) throw new Error(`encontro ${id} não está no cenário`);
      return Promise.resolve(achado);
    },
    getItem,
    getItemIcon,
  } as unknown as BlizzardService;

  const wcl = {
    getRaidCatalog: () => Promise.resolve(catalogo(cenario.wcl)),
  } as unknown as WarcraftLogsService;

  return { service: new LootCatalogGeneratorService(blizzard, wcl), getItem, getItemIcon };
}

/**
 * Boss numa posição, ou falha dizendo o que faltou.
 *
 * Existe porque `!` não passa no lint e porque `expect(undefined)` passaria de
 * graça em asserção negativa — `not.toHaveProperty` num valor inexistente
 * aprova o teste sem testar nada.
 */
function bossEm(arquivo: CatalogFile, posicao: number): CatalogFileBoss {
  const boss = arquivo.bosses[posicao];
  if (!boss) throw new Error(`esperava um boss na posição ${posicao}`);
  return boss;
}

function primeiroItem(boss: CatalogFileBoss): CatalogFileItem {
  const [item] = boss.items;
  if (!item) throw new Error(`${boss.name} saiu sem item nenhum`);
  return item;
}

describe('LootCatalogGeneratorService', () => {
  describe('id do boss contra o Warcraft Logs', () => {
    it('descarta o espelho de PTR/Beta e fica com o id ao vivo', async () => {
      // O WCL publica a raid duas vezes enquanto está em teste, com o id
      // somado de 50000. Sem descartar, TODA raid nova sairia ambígua.
      const { service } = montar({
        journal: [encontro(10, 'Imperator Averzian')],
        wcl: [
          encounter(3176, 'Imperator Averzian', 46),
          encounter(53176, 'Imperator Averzian', 48),
        ],
      });

      const arquivo = await service.gerar(1307);

      expect(arquivo.bosses[0].dungeonEncounterId).toBe(3176);
    });

    it('mantém id alto que NÃO tem gêmeo, em vez de sumir com ele', async () => {
      // O corte é o gêmeo em `id - 50000`, não o tamanho do número: encounter ao
      // vivo que um dia nasça com id alto tem que continuar passando.
      const { service } = montar({
        journal: [encontro(10, 'Boss Futuro')],
        wcl: [encounter(51234, 'Boss Futuro')],
      });

      const arquivo = await service.gerar(1307);

      expect(arquivo.bosses[0].dungeonEncounterId).toBe(51234);
    });

    it('recusa a raid inteira quando o nome é ambíguo de verdade', async () => {
      // Artificer Xy'mox existe em Castle Nathria e em Sepulcher: dois bosses
      // diferentes com o mesmo nome, e nenhum é espelho do outro. Escolher um
      // gravaria o boss da raid errada, e o sintoma só apareceria na noite de
      // raid como "a colagem do addon não casa".
      const { service } = montar({
        journal: [encontro(10, "Artificer Xy'mox")],
        wcl: [encounter(2405, "Artificer Xy'mox", 26), encounter(2553, "Artificer Xy'mox", 29)],
      });

      await expect(service.gerar(1307)).rejects.toThrow(/ambíguo.*2405, 2553/s);
    });

    it('deixa o boss sem id quando o WCL não o conhece, sem falhar', async () => {
      // Raid recém-lançada existe no journal antes de o WCL conhecê-la — que é
      // justamente quando a gente quer gerar o arquivo.
      const { service } = montar({
        journal: [encontro(10, 'Boss Novo')],
        wcl: [],
      });

      const arquivo = await service.gerar(1307);

      expect(arquivo.bosses[0].dungeonEncounterId).toBeUndefined();
    });
  });

  describe('dificuldades', () => {
    it('descarta LFR e mantém as três que a guilda roda', async () => {
      const { service } = montar({
        journal: [
          encontro(10, 'Boss', {
            modes: [
              { type: 'LFR', name: 'Raid Finder' },
              { type: 'NORMAL', name: 'Normal' },
              { type: 'HEROIC', name: 'Heroic' },
              { type: 'MYTHIC', name: 'Mythic' },
            ],
          }),
        ],
        wcl: [encounter(3176, 'Boss')],
      });

      const arquivo = await service.gerar(1307);

      expect(arquivo.bosses[0].difficulties).toEqual([
        RAID_DIFFICULTIES.NORMAL,
        RAID_DIFFICULTIES.HEROIC,
        RAID_DIFFICULTIES.MYTHIC,
      ]);
    });

    it('falha quando sobra nenhuma dificuldade conhecida', async () => {
      // Boss só de LFR não é erro de dado, mas gerar um boss sem dificuldade
      // nenhuma produziria arquivo que o carregador recusa sem explicar.
      const { service } = montar({
        journal: [encontro(10, 'Boss', { modes: [{ type: 'LFR', name: 'Raid Finder' }] })],
        wcl: [encounter(3176, 'Boss')],
      });

      await expect(service.gerar(1307)).rejects.toThrow(/nenhuma dificuldade conhecida.*LFR/s);
    });
  });

  describe('item', () => {
    it('preserva os dois primários de um trinket que tem str e agi', async () => {
      // Light Company Guidon (249344) é o caso real que motivou `primaryStats`
      // ser lista em vez de campo único.
      const { service } = montar({
        journal: [encontro(10, 'Boss', { items: [{ item: { id: 249344, name: 'Guidon' } }] })],
        wcl: [encounter(3176, 'Boss')],
        itens: {
          249344: {
            preview_item: {
              stats: [
                { type: { type: 'AGILITY' } },
                { type: { type: 'STRENGTH' } },
                { type: { type: 'CRIT_RATING' } },
              ],
            },
          },
        },
      });

      const arquivo = await service.gerar(1307);

      expect(primeiroItem(bossEm(arquivo, 0)).primaryStats).toEqual([
        PRIMARY_STATS.AGILITY,
        PRIMARY_STATS.STRENGTH,
      ]);
    });

    it('não escreve usableBySpecs, nem vazio', async () => {
      // O carregador lê lista vazia como "não decidi" e preserva a curadoria que
      // já está no banco. Escrever `[]` aqui seria gravar uma decisão que
      // ninguém tomou.
      const { service } = montar({
        journal: [encontro(10, 'Boss')],
        wcl: [encounter(3176, 'Boss')],
      });

      const arquivo = await service.gerar(1307);

      expect(primeiroItem(bossEm(arquivo, 0))).not.toHaveProperty('usableBySpecs');
    });

    it('omite campo que a API não devolveu, em vez de gravar nulo', async () => {
      const { service } = montar({
        journal: [encontro(10, 'Boss')],
        wcl: [encounter(3176, 'Boss')],
      });

      const arquivo = await service.gerar(1307);
      const item = primeiroItem(bossEm(arquivo, 0));

      expect(item).not.toHaveProperty('equipLoc');
      expect(item).not.toHaveProperty('primaryStats');
      expect(item.name).toBe('Item 100');
    });

    it('busca uma vez só a peça que cai de dois bosses', async () => {
      // Cada item custa duas chamadas, uma de dado e uma de mídia. Sem cache,
      // token compartilhado entre bosses vira chamada repetida a cada boss.
      const { service, getItem, getItemIcon } = montar({
        journal: [
          encontro(10, 'Boss A', { items: [{ item: { id: 500, name: 'Token' } }] }),
          encontro(11, 'Boss B', { items: [{ item: { id: 500, name: 'Token' } }] }),
        ],
        wcl: [encounter(3176, 'Boss A'), encounter(3177, 'Boss B')],
      });

      const arquivo = await service.gerar(1307);

      expect(getItem).toHaveBeenCalledTimes(1);
      expect(getItemIcon).toHaveBeenCalledTimes(1);
      expect(primeiroItem(bossEm(arquivo, 1)).itemId).toBe(500);
    });
  });

  it('numera os bosses na ordem do journal e sugere slug a partir do nome', async () => {
    const { service } = montar({
      journal: [encontro(10, 'Boss A'), encontro(11, 'Boss B')],
      wcl: [encounter(3176, 'Boss A'), encounter(3177, 'Boss B')],
    });

    const arquivo = await service.gerar(1307);

    expect(arquivo.slug).toBe('the-voidspire');
    expect(arquivo.bosses.map((b) => b.position)).toEqual([0, 1]);
  });

  describe('dump do Encounter Journal', () => {
    const dump = (over: Partial<JournalDump> = {}): JournalDump => ({
      journalInstanceId: 1307,
      instanceMapId: 2912,
      bosses: [{ journalEncounterId: 10, dungeonEncounterId: 3176, items: [] }],
      ...over,
    });

    it('tira o id do dump e não consulta o Warcraft Logs', async () => {
      // O WCL é deixado de propósito com o boss em nome AMBÍGUO: se o gerador
      // ainda estivesse casando por nome, isto derrubaria a geração.
      const { service } = montar({
        journal: [encontro(10, "Artificer Xy'mox")],
        wcl: [encounter(2405, "Artificer Xy'mox", 26), encounter(2553, "Artificer Xy'mox", 29)],
      });

      const arquivo = await service.gerar(1307, undefined, dump());

      expect(bossEm(arquivo, 0).dungeonEncounterId).toBe(3176);
    });

    it('casa por journalEncounterId, não por posição', async () => {
      // No journal real os ids saem fora de ordem crescente — 2736 vem antes de
      // 2735 — então casar por posição daria o boss errado sem erro nenhum.
      const { service } = montar({
        journal: [encontro(20, 'Boss A'), encontro(19, 'Boss B')],
        wcl: [],
      });

      const arquivo = await service.gerar(1307, undefined, {
        journalInstanceId: 1307,
        bosses: [
          { journalEncounterId: 19, dungeonEncounterId: 3179, items: [] },
          { journalEncounterId: 20, dungeonEncounterId: 3178, items: [] },
        ],
      });

      expect(bossEm(arquivo, 0).dungeonEncounterId).toBe(3178);
      expect(bossEm(arquivo, 1).dungeonEncounterId).toBe(3179);
    });

    it('recusa dump de outra raid', async () => {
      // Erro fácil de cometer com dois arquivos abertos, e sem esta checagem a
      // raid inteira sairia sem id nenhum.
      const { service } = montar({ journal: [encontro(10, 'Boss')], wcl: [] });

      await expect(
        service.gerar(1307, undefined, dump({ journalInstanceId: 1314 })),
      ).rejects.toThrow(/1314.*1307/s);
    });

    it('deixa sem id o boss que o dump não cobre', async () => {
      const { service } = montar({
        journal: [encontro(10, 'Boss A'), encontro(11, 'Boss B')],
        wcl: [encounter(3177, 'Boss B')],
      });

      const arquivo = await service.gerar(1307, undefined, dump());

      expect(bossEm(arquivo, 0).dungeonEncounterId).toBe(3176);
      // Não cai no nome como plano B: misturar as duas fontes na mesma geração
      // esconderia que o dump está incompleto.
      expect(bossEm(arquivo, 1).dungeonEncounterId).toBeUndefined();
    });

    it('preenche instanceMapId a partir do dump', async () => {
      const { service } = montar({ journal: [encontro(10, 'Boss')], wcl: [] });

      const arquivo = await service.gerar(1307, undefined, dump());

      expect(arquivo.instanceMapId).toBe(2912);
    });
  });

  it('preenche instanceMapId a partir da REST quando não há dump', async () => {
    const { service } = montar({
      journal: [encontro(10, 'Boss')],
      wcl: [encounter(3176, 'Boss')],
      map: { id: 2912, name: 'The Voidspire' },
    });

    const arquivo = await service.gerar(1307);

    expect(arquivo.instanceMapId).toBe(2912);
  });

  it('omite instanceMapId quando nenhuma fonte tem', async () => {
    const { service } = montar({ journal: [encontro(10, 'Boss')], wcl: [encounter(3176, 'Boss')] });

    const arquivo = await service.gerar(1307);

    expect(arquivo).not.toHaveProperty('instanceMapId');
  });

  it('respeita o slug passado à mão', async () => {
    const { service } = montar({
      journal: [encontro(10, 'Boss')],
      wcl: [encounter(3176, 'Boss')],
    });

    const arquivo = await service.gerar(1307, 'voidspire');

    expect(arquivo.slug).toBe('voidspire');
  });
});
