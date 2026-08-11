import type { TeamCharacter, WowAuditService } from '../wowaudit/wowaudit.service';
import { ProgressService } from './progress.service';
import type { SnapshotsRepository } from './snapshots.repository';

/** Uma linha como o repository devolve. Dados fictícios — ver CLAUDE.md. */
const linha = (nome: string, period: number, itemLevel: number | null, realmSlug = 'azralon') => ({
  period,
  nameKey: nome.toLowerCase(),
  realmSlug,
  name: nome,
  itemLevel,
  keysDone: null,
  highestKey: null,
  seasonRuns: null,
  seasonRunsTimed: null,
});

const char = (name: string, realm = 'Azralon'): TeamCharacter => ({
  name,
  realm,
  wowClass: 'Priest',
  role: 'Heal',
});

const seasonRow = (id: number, startedAt: string, raiderioSlug: string | null = 'season-mn-1') => ({
  id,
  patch: '12.0',
  name: `Season ${id}`,
  raiderioSlug,
  firstPeriod: 1055,
  periodCount: 20,
  startedAt: new Date(startedAt),
});

describe('ProgressService', () => {
  const repo = {
    listSeasons: jest.fn(),
    findSeason: jest.fn(),
    findSeasonSnapshots: jest.fn(),
  };
  const wowaudit = { getTeamCharacters: jest.fn() };

  let service: ProgressService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    repo.listSeasons.mockResolvedValue([seasonRow(17, '2026-03-17T00:00:00Z')]);
    repo.findSeasonSnapshots.mockResolvedValue([
      linha('Fulano', 1074, 300),
      linha('Beltrano', 1074, 280),
    ]);
    wowaudit.getTeamCharacters.mockResolvedValue([char('Fulano'), char('Beltrano')]);

    service = new ProgressService(
      repo as unknown as SnapshotsRepository,
      wowaudit as unknown as WowAuditService,
    );
  });

  it('tira da semana corrente quem não está mais no time', async () => {
    // Entrou no WoWAudit, foi fotografado, saiu depois. A linha sobrou.
    repo.findSeasonSnapshots.mockResolvedValue([
      linha('Fulano', 1074, 300),
      linha('Beltrano', 1074, 280),
      linha('Sicrano', 1074, 147),
    ]);

    const report = await service.getReport();

    expect(report?.rows.map((r) => r.name)).toEqual(['Fulano', 'Beltrano']);
  });

  it('não deixa quem saiu do time afundar a média', async () => {
    repo.findSeasonSnapshots.mockResolvedValue([
      linha('Fulano', 1074, 300),
      linha('Beltrano', 1074, 280),
      linha('Sicrano', 1074, 147),
    ]);

    const report = await service.getReport();

    // 290, não 242,33: é o que decide o `vs média` de todo mundo na tela.
    expect(report?.average.itemLevel).toBe(290);
  });

  it('casa o par nome + realm, não o nome sozinho', async () => {
    // Mesmo nome em realms diferentes são pessoas diferentes — Regra 6.
    repo.findSeasonSnapshots.mockResolvedValue([
      linha('Fulano', 1074, 300, 'azralon'),
      linha('Fulano', 1074, 147, 'goldrinn'),
    ]);
    wowaudit.getTeamCharacters.mockResolvedValue([char('Fulano', 'Azralon')]);

    const report = await service.getReport();

    expect(report?.rows).toHaveLength(1);
    expect(report?.rows[0]?.itemLevel).toBe(300);
  });

  it('normaliza acento e caixa do jeito que o job gravou', async () => {
    // O job grava com toCharacterKey (mantém acento) e toSlug no realm. O
    // filtro tem que compor a chave igual, senão não casa ninguém.
    repo.findSeasonSnapshots.mockResolvedValue([linha('Shrëwd', 1074, 300, 'area-52')]);
    wowaudit.getTeamCharacters.mockResolvedValue([char('Shrëwd', 'Area 52')]);

    const report = await service.getReport();

    expect(report?.rows.map((r) => r.name)).toEqual(['Shrëwd']);
  });

  it('não filtra season que não é a mais recente', async () => {
    // Season passada é história: o time de hoje não descreve a semana dela.
    repo.listSeasons.mockResolvedValue([
      seasonRow(18, '2026-08-18T00:00:00Z'),
      seasonRow(17, '2026-03-17T00:00:00Z'),
    ]);
    repo.findSeason.mockResolvedValue(seasonRow(17, '2026-03-17T00:00:00Z'));
    repo.findSeasonSnapshots.mockResolvedValue([
      linha('Fulano', 1074, 300),
      linha('Sicrano', 1074, 147),
    ]);

    const report = await service.getReport(17);

    expect(report?.rows.map((r) => r.name)).toEqual(['Fulano', 'Sicrano']);
    expect(wowaudit.getTeamCharacters).not.toHaveBeenCalled();
  });

  it('sai sem filtro quando o WoWAudit está fora, em vez de quebrar', async () => {
    repo.findSeasonSnapshots.mockResolvedValue([
      linha('Fulano', 1074, 300),
      linha('Sicrano', 1074, 147),
    ]);
    wowaudit.getTeamCharacters.mockRejectedValue(new Error('WoWAudit falhou'));

    const report = await service.getReport();

    expect(report?.rows.map((r) => r.name)).toEqual(['Fulano', 'Sicrano']);
  });

  it('sai sem filtro quando o time vem vazio, em vez de entregar tabela vazia', async () => {
    // Time vazio é falha de leitura, não guilda sem gente — mesma leitura que
    // o job faz ao abortar o snapshot.
    wowaudit.getTeamCharacters.mockResolvedValue([]);

    const report = await service.getReport();

    expect(report?.rows.map((r) => r.name)).toEqual(['Fulano', 'Beltrano']);
  });

  it('marca a season sem slug do Raider.IO como M+ ainda não aberto', async () => {
    // É a semana entre o patch e a abertura do M+. A tela precisa disto para
    // dizer por que a coluna da season está vazia.
    repo.listSeasons.mockResolvedValue([seasonRow(18, '2026-08-11T15:00:00Z', null)]);

    const report = await service.getReport();

    expect(report?.mythicPlusOpen).toBe(false);
  });

  it('com slug gravado, o M+ da season está aberto', async () => {
    const report = await service.getReport();

    expect(report?.mythicPlusOpen).toBe(true);
  });

  it('compara com a semana anterior de quem ficou', async () => {
    repo.findSeasonSnapshots.mockResolvedValue([
      linha('Fulano', 1073, 290),
      linha('Fulano', 1074, 300),
      linha('Beltrano', 1074, 280),
    ]);

    const report = await service.getReport();

    expect(report?.rows.find((r) => r.name === 'Fulano')?.itemLevelDelta).toBe(10);
  });
});
