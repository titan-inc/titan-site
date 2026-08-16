import type { BlizzardService, CurrentSeason } from '../blizzard/blizzard.service';
import {
  chaveDe,
  indice,
  type CharactersRepository,
  type PersonagemDaFonte,
} from '../characters/characters.repository';
import type { GameVersionService } from '../gameversion/gameversion.service';
import type { RaiderIoService } from '../raiderio/raiderio.service';
import type { TeamCharacter, WowAuditService } from '../wowaudit/wowaudit.service';
import type { SnapshotInput, SnapshotsRepository } from './snapshots.repository';
import { SnapshotsService } from './snapshots.service';

/** Id determinístico a partir da chave, só para o teste comparar. */
const idDoPersonagem = (p: PersonagemDaFonte): string => `char:${indice(chaveDe(p))}`;

// O serviço lê a config da guilda no construtor, e ela falha alto quando está
// ausente — de propósito, porque guilda errada dá roster vazio em vez de erro.
// Aqui só satisfazemos isso; o comportamento da config tem spec próprio.
process.env.GUILD_NAME = 'Guilda de Teste';
process.env.GUILD_REALM = 'Realm de Teste';

// Dados fictícios: nada de nome real de membro em fixture — ver CLAUDE.md.
const season = (over: Partial<CurrentSeason> = {}): CurrentSeason => ({
  id: 17,
  name: 'Mythic+ Dungeons (Midnight Season 1)',
  startedAt: new Date('2026-03-17T00:00:00Z'),
  firstPeriod: 1055,
  periodCount: 20,
  currentPeriod: 1074,
  weekInSeason: 20,
  ...over,
});

const char = (name: string, realm = 'Azralon'): TeamCharacter => ({
  name,
  realm,
  wowClass: 'Priest',
  role: 'Heal',
});

describe('SnapshotsService', () => {
  const blizzard = { getCurrentSeason: jest.fn() };
  const wowaudit = { getTeamCharacters: jest.fn(), getWeeklyKeys: jest.fn() };
  const raiderio = { getProgress: jest.fn() };
  const gameVersion = { getPatchLabel: jest.fn() };
  const repo = {
    upsertSeason: jest.fn(),
    saveSnapshots: jest.fn(),
    findSeasonByRaiderioSlug: jest.fn(),
    setRaiderioSlug: jest.fn(),
  };
  const characters = {
    resolverVarios: jest.fn((personagens: PersonagemDaFonte[]) =>
      Promise.resolve(new Map(personagens.map((p) => [indice(chaveDe(p)), idDoPersonagem(p)]))),
    ),
  };

  let service: SnapshotsService;

  /** O que foi mandado gravar, tipado — `mock.calls` é `any`. */
  const gravados = (): SnapshotInput[] => {
    const calls = repo.saveSnapshots.mock.calls as unknown as Array<[SnapshotInput[]]>;
    return calls[0]?.[0] ?? [];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    blizzard.getCurrentSeason.mockResolvedValue(season());
    wowaudit.getTeamCharacters.mockResolvedValue([char('Fulano')]);
    wowaudit.getWeeklyKeys.mockResolvedValue([]);
    raiderio.getProgress.mockResolvedValue({
      itemLevel: 293.06,
      mythicPlusScore: 3412.1,
      season: 'season-mn-1',
      seasonRuns: 182,
      seasonRunsTimed: 165,
    });
    gameVersion.getPatchLabel.mockResolvedValue('12.0');
    repo.upsertSeason.mockResolvedValue(undefined);
    // O caso normal: o slug que o Raider.IO responde é o da season corrente.
    repo.findSeasonByRaiderioSlug.mockResolvedValue({ id: 17 });
    repo.setRaiderioSlug.mockResolvedValue(undefined);
    repo.saveSnapshots.mockImplementation((e: unknown[]) => Promise.resolve(e.length));

    service = new SnapshotsService(
      blizzard as unknown as BlizzardService,
      wowaudit as unknown as WowAuditService,
      raiderio as unknown as RaiderIoService,
      gameVersion as unknown as GameVersionService,
      repo as unknown as SnapshotsRepository,
      characters as unknown as CharactersRepository,
    );
  });

  it('grava a foto do period corrente com a season junto', async () => {
    wowaudit.getWeeklyKeys.mockResolvedValue([
      { nameKey: 'fulano', realmSlug: 'azralon', name: 'Fulano', count: 3, highest: 10 },
    ]);

    const result = await service.takeSnapshot();

    expect(repo.upsertSeason).toHaveBeenCalledWith(
      expect.objectContaining({ id: 17, patch: '12.0', firstPeriod: 1055 }),
    );
    expect(repo.saveSnapshots).toHaveBeenCalledWith([
      expect.objectContaining({
        period: 1074,
        seasonId: 17,
        characterId: idDoPersonagem({ name: 'Fulano', realm: 'Azralon' }),
        itemLevel: 293.06,
        keysDone: 3,
        highestKey: 10,
        // Acumulado da season vem do Raider.IO, completo — a soma das nossas
        // semanas subestimaria quem já jogava antes do tracking do WoWAudit.
        seasonRuns: 182,
      }),
    ]);
    expect(result).toMatchObject({ status: 'ok', recorded: 1, weekInSeason: 20 });
  });

  it('casa keys por nome + realm, respeitando acento', async () => {
    // Shrëwd e Shrèwd são pessoas diferentes. Se a chave removesse acento, a
    // key de uma entraria na foto da outra.
    wowaudit.getTeamCharacters.mockResolvedValue([char('Shrëwd'), char('Shrèwd')]);
    wowaudit.getWeeklyKeys.mockResolvedValue([
      { nameKey: 'shrëwd', realmSlug: 'azralon', name: 'Shrëwd', count: 5, highest: 12 },
    ]);

    await service.takeSnapshot();

    const idShrewd = idDoPersonagem({ name: 'Shrëwd', realm: 'Azralon' });
    const idShrevd = idDoPersonagem({ name: 'Shrèwd', realm: 'Azralon' });

    expect(gravados().find((g) => g.characterId === idShrewd)?.keysDone).toBe(5);
    expect(gravados().find((g) => g.characterId === idShrevd)?.keysDone).toBeNull();
  });

  it('item level ausente vira null, NUNCA zero', async () => {
    // Zero seria lido como "a pessoa está sem gear". O gráfico precisa de
    // lacuna, não de um ponto falso no eixo.
    raiderio.getProgress.mockResolvedValue({
      itemLevel: null,
      mythicPlusScore: null,
      seasonRuns: null,
      seasonRunsTimed: null,
    });

    const result = await service.takeSnapshot();

    expect(gravados()[0]?.itemLevel).toBeNull();
    expect(result).toMatchObject({ withoutItemLevel: 1 });
  });

  it('não grava nada quando o time vem vazio', async () => {
    // Time vazio é falha de leitura, não guilda sem gente. Gravar criaria uma
    // semana que parece medida e não foi.
    wowaudit.getTeamCharacters.mockResolvedValue([]);

    const result = await service.takeSnapshot();

    expect(result).toMatchObject({ status: 'aborted' });
    expect(repo.saveSnapshots).not.toHaveBeenCalled();
  });

  it('grava mesmo sem o rótulo de patch', async () => {
    // O patch é enfeite de exibição e vem de fonte sem contrato. Ele não pode
    // impedir a gravação do que importa.
    gameVersion.getPatchLabel.mockResolvedValue(null);

    const result = await service.takeSnapshot();

    expect(repo.upsertSeason).toHaveBeenCalledWith(expect.objectContaining({ patch: null }));
    expect(result).toMatchObject({ status: 'ok' });
  });

  it('grava o item level mesmo quando as keys falham', async () => {
    wowaudit.getWeeklyKeys.mockRejectedValue(new Error('WoWAudit fora do ar'));

    const result = await service.takeSnapshot();

    expect(gravados()[0]?.itemLevel).toBe(293.06);
    expect(gravados()[0]?.keysDone).toBeNull();
    expect(result).toMatchObject({ status: 'ok' });
  });

  it('semana sem registro no WoWAudit não vira zero', async () => {
    // 86 de 440 pares personagem×semana da season 17 não têm registro. Gravar
    // zero ali inventaria "não fez nada" para quem a ferramenta nem observava,
    // e afundaria a média do time no relatório.
    wowaudit.getWeeklyKeys.mockResolvedValue([
      { nameKey: 'fulano', realmSlug: 'azralon', name: 'Fulano', count: null, highest: null },
    ]);

    await service.takeSnapshot();

    expect(gravados()[0]?.keysDone).toBeNull();
  });

  describe('a semana entre o patch e a abertura do M+', () => {
    // A season de M+ abre uma semana depois do patch. Nesse intervalo a
    // Blizzard já publicou a season nova e o Raider.IO ainda responde a
    // anterior — foi o que aconteceu em 11/08/2026 na virada da 12.0 para a
    // 12.1, e o acumulado da 12.0 entrou no banco como se fosse da 12.1.
    const preSeason = () => {
      blizzard.getCurrentSeason.mockResolvedValue(season({ id: 18, currentPeriod: 1076 }));
      repo.findSeasonByRaiderioSlug.mockResolvedValue({ id: 17 });
    };

    it('não atribui o M+ da season anterior à season nova', async () => {
      preSeason();

      const result = await service.takeSnapshot();

      expect(gravados()[0]).toMatchObject({
        seasonId: 18,
        mythicPlusScore: null,
        seasonRuns: null,
        seasonRunsTimed: null,
      });
      expect(result).toMatchObject({ status: 'ok', mythicPlusOpen: false });
    });

    it('mas continua medindo item level, que não é da season', async () => {
      preSeason();

      await service.takeSnapshot();

      expect(gravados()[0]?.itemLevel).toBe(293.06);
    });

    it('quando o M+ abre, a season adota o slug e volta a gravar', async () => {
      blizzard.getCurrentSeason.mockResolvedValue(season({ id: 18, currentPeriod: 1077 }));
      raiderio.getProgress.mockResolvedValue({
        itemLevel: 293.06,
        mythicPlusScore: 180.4,
        season: 'season-mn-2',
        seasonRuns: 4,
        seasonRunsTimed: 3,
      });
      // Slug novo, de ninguém ainda.
      repo.findSeasonByRaiderioSlug.mockResolvedValue(null);

      const result = await service.takeSnapshot();

      expect(repo.setRaiderioSlug).toHaveBeenCalledWith(18, 'season-mn-2');
      expect(gravados()[0]).toMatchObject({ seasonRuns: 4, mythicPlusScore: 180.4 });
      expect(result).toMatchObject({ mythicPlusOpen: true });
    });

    it('sem o Raider.IO nomear season nenhuma, não afirma que abriu', async () => {
      raiderio.getProgress.mockResolvedValue({
        itemLevel: 293.06,
        mythicPlusScore: null,
        season: null,
        seasonRuns: null,
        seasonRunsTimed: null,
      });

      const result = await service.takeSnapshot();

      expect(repo.setRaiderioSlug).not.toHaveBeenCalled();
      expect(result).toMatchObject({ mythicPlusOpen: false });
    });
  });

  it('a rodada agendada não deixa exceção escapar', async () => {
    blizzard.getCurrentSeason.mockRejectedValue(new Error('Blizzard fora do ar'));

    await expect(service.snapshotScheduled()).resolves.toBeUndefined();
  });
});
