import type { RaidCatalog, RaidEncounter } from '../warcraftlogs/warcraftlogs.service';
import { PreparacaoService } from './preparacao.service';
import type { TitanBetRepository } from './titan-bet.repository';

/**
 * O catálogo da preparação (D-22) com o conteúdo atual da guilda (B2,
 * titan-bet-test-design.md §41): a zone vem da progressão; o catálogo inteiro
 * continua vindo, para o "Mostrar todas".
 */

process.env.GUILD_TIMEZONE = 'America/Sao_Paulo';

const boss = (id: number, name: string, zoneId: number, zoneName: string): RaidEncounter => ({
  id,
  name,
  zoneId,
  zoneName,
  order: 0,
});
const b46 = boss(3176, 'Imperator Averzian', 46, 'VS / DR / MQD');
const b53 = boss(3470, "Nek'zali the Soulcoiler", 53, 'The Venomous Abyss');
const b54 = boss(53470, "Nek'zali the Soulcoiler", 54, 'The Venomous Abyss');
const catalogo: RaidCatalog = {
  encounters: new Map([b46, b53, b54].map((b) => [b.id, b])),
  zones: new Map([
    [46, [b46]],
    [53, [b53]],
    [54, [b54]],
  ]),
  difficultyNames: new Map(),
};

const criar = (zonaAtual: number | null) =>
  new PreparacaoService(
    {} as TitanBetRepository,
    { getCurrentSeason: () => Promise.resolve({ currentPeriod: 1 }) },
    { getRaidCatalog: () => Promise.resolve(catalogo) },
    { zonaAtual: () => Promise.resolve(zonaAtual) },
  );

describe('PreparacaoService.catalogo — conteúdo atual (B2)', () => {
  it('traz a zone atual inferida da atividade real, e o catálogo inteiro', async () => {
    const c = await criar(53).catalogo();
    expect(c.zonaAtual).toBe(53);
    expect(c.zonas.map((z) => z.zoneId)).toEqual([46, 53, 54]);
  });

  it('sem conteúdo atual determinado: null, e o catálogo inteiro', async () => {
    const c = await criar(null).catalogo();
    expect(c.zonaAtual).toBeNull();
    expect(c.zonas).toHaveLength(3);
  });
});
