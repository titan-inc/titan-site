import {
  toRaidPulls,
  type RaidCatalog,
  type RaidEncounter,
  type WclReport,
} from './warcraftlogs.service';

const boss = (id: number, name: string, zoneId: number, order: number): RaidEncounter => ({
  id,
  name,
  zoneId,
  zoneName: 'Tier de Teste',
  order,
});

/** Catálogo com dois bosses de raid. Nada de dungeon dentro dele, de propósito. */
const catalogo = (): RaidCatalog => {
  const bosses = [boss(3176, 'Primeiro Boss', 46, 0), boss(3183, 'Último Boss', 46, 1)];
  return {
    encounters: new Map(bosses.map((b) => [b.id, b])),
    zones: new Map([[46, bosses]]),
    difficultyNames: new Map([
      [5, 'Mythic'],
      [4, 'Heroic'],
    ]),
  };
};

const relatorio = (fights: WclReport['fights']): WclReport => ({
  code: 'aBcD1234',
  startTime: 1_000_000,
  fights,
});

const fight = (over: Partial<WclReport['fights'][number]> = {}): WclReport['fights'][number] => ({
  encounterID: 3176,
  name: 'Primeiro Boss',
  difficulty: 5,
  kill: false,
  fightPercentage: 42.5,
  startTime: 500,
  gameZone: { id: 2912, name: 'Raid Um' },
  ...over,
});

describe('toRaidPulls', () => {
  it('descarta trash', () => {
    // encounterID 0 com difficulty null é trash. Sem este filtro a contagem de
    // tries começa inflada com corredor.
    const pulls = toRaidPulls(
      [relatorio([fight(), fight({ encounterID: 0, difficulty: null, kill: null })])],
      catalogo(),
    );

    expect(pulls).toHaveLength(1);
    expect(pulls[0]?.encounterId).toBe(3176);
  });

  it('descarta boss de dungeon mesmo em difficulty de raid', () => {
    // Este é o ponto: boss de M+ aparece em difficulty 5, igual a boss mítico
    // de raid. Quem separa é o encounter não estar no catálogo de raid.
    const pulls = toRaidPulls(
      [relatorio([fight(), fight({ encounterID: 12874, name: 'Boss de Dungeon', difficulty: 5 })])],
      catalogo(),
    );

    expect(pulls.map((p) => p.encounterId)).toEqual([3176]);
  });

  it('filtra pull a pull, não relatório a relatório', () => {
    // Um relatório mistura raid, run de alt e dungeon. Descartar o relatório
    // inteiro por causa da dungeon perderia as pulls de raid dele.
    const pulls = toRaidPulls(
      [
        relatorio([
          fight({ encounterID: 12805, name: 'Boss de Dungeon' }),
          fight({ encounterID: 3183 }),
          fight({ encounterID: 0, difficulty: null }),
        ]),
      ],
      catalogo(),
    );

    expect(pulls.map((p) => p.encounterId)).toEqual([3183]);
  });

  it('converte o offset da pull em horário absoluto', () => {
    // `fights.startTime` é offset dentro do relatório. Usar ele cru como epoch
    // colocaria toda kill em 1970.
    const pulls = toRaidPulls([relatorio([fight({ startTime: 500 })])], catalogo());

    expect(pulls[0]?.startedAt).toBe(1_000_500);
  });

  it('trata kill ausente como não-kill', () => {
    const pulls = toRaidPulls([relatorio([fight({ kill: null })])], catalogo());

    expect(pulls[0]?.kill).toBe(false);
  });
});
