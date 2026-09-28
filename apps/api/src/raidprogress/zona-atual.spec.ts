import type { RaidCatalog, RaidEncounter, RaidPull } from '../warcraftlogs/warcraftlogs.service';
import { zonaDaAtividadeMaisRecente } from './zona-atual';

/**
 * O conteúdo atual da guilda (B2, decisão de 24/09/2026): a zone da atividade
 * de raid real mais recente. Nunca o maior id, a posição, o nome ou a data do
 * catálogo. titan-bet-test-design.md §41.
 *
 * Os ids são os do catálogo real: 46 "VS / DR / MQD", 53 "The Venomous Abyss",
 * 54 o espelho de Beta da 53 (mesmos bosses, id + 50000), 52 Dummy Dome (só
 * Normal) e 41 Delves (dificuldades 108/109).
 */

const boss = (id: number, name: string, zoneId: number): RaidEncounter => ({
  id,
  name,
  zoneId,
  zoneName: `Zona ${zoneId}`,
  order: 0,
});

const bosses = [
  boss(3176, 'Imperator Averzian', 46),
  boss(3470, "Nek'zali the Soulcoiler", 53),
  boss(3497, 'The Lost Explorers', 53),
  boss(53470, "Nek'zali the Soulcoiler", 54),
  boss(3400, 'Sinister Single', 52),
  boss(3010, 'The Underpin', 41),
];

const catalogo: RaidCatalog = {
  encounters: new Map(bosses.map((b) => [b.id, b])),
  zones: new Map(),
  difficultyNames: new Map(),
};

const dia = (d: string) => Date.parse(`${d}T23:00:00Z`);

const pull = (encounterId: number, startedAt: number, difficulty = 5): RaidPull => ({
  encounterId,
  difficulty,
  kill: false,
  fightPercentage: 50,
  startedAt,
  gameZoneId: null,
  gameZoneName: null,
});

describe('zonaDaAtividadeMaisRecente', () => {
  it('a zone 53 sai dos logs atuais', () => {
    expect(
      zonaDaAtividadeMaisRecente(
        [pull(3470, dia('2026-09-15')), pull(3497, dia('2026-09-17'))],
        catalogo,
      ),
    ).toBe(53);
  });

  it('zone 46 antes, zone 53 depois → 53', () => {
    expect(
      zonaDaAtividadeMaisRecente(
        [
          pull(3176, dia('2026-08-20')),
          pull(3470, dia('2026-09-15')),
          pull(3176, dia('2026-08-27')),
        ],
        catalogo,
      ),
    ).toBe(53);
  });

  it('pull no espelho de Beta (zone 54), mesmo mais recente, não vira o tier atual', () => {
    expect(
      zonaDaAtividadeMaisRecente(
        [pull(3470, dia('2026-09-15')), pull(53470, dia('2026-09-20'))],
        catalogo,
      ),
    ).toBe(53);
  });

  it('a zone 54 existir no catálogo não basta: sem atividade, nada é inferido', () => {
    expect(zonaDaAtividadeMaisRecente([], catalogo)).toBeNull();
  });

  it('dummy e delve não são atividade de raid, nem sendo o mais recente', () => {
    expect(
      zonaDaAtividadeMaisRecente(
        [
          pull(3470, dia('2026-09-15')),
          pull(3400, dia('2026-09-21'), 3),
          pull(3010, dia('2026-09-22'), 108),
        ],
        catalogo,
      ),
    ).toBe(53);
  });

  it('só pulls fora do Mythic → nenhum tier inferido', () => {
    expect(
      zonaDaAtividadeMaisRecente(
        [pull(3470, dia('2026-09-15'), 4), pull(3176, dia('2026-09-16'), 3)],
        catalogo,
      ),
    ).toBeNull();
  });

  it('boss fora do catálogo não conta', () => {
    expect(zonaDaAtividadeMaisRecente([pull(999_999, dia('2026-09-22'))], catalogo)).toBeNull();
  });
});
