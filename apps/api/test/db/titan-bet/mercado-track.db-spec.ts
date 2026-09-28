import { PrismaService } from '../../../src/prisma/prisma.service';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * T-R17 — o `track` do mercado anda junto com o encounter.
 *
 * A FK composta `(roundEncounterId, roundId, track)` é MATCH SIMPLE: com
 * qualquer coluna NULL, o Postgres não confere nada. Um mercado de boss com
 * `track` NULL escaparia da conferência contra o encounter (R-22/R-24), e um
 * `track` sem encounter não significa nada. Ver titan-bet-test-design.md §11.4.
 */
describe('Titan Bet — track do mercado (banco)', () => {
  let db: PrismaService;
  let f: Fabrica;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('recusa mercado de boss com roundEncounterId e sem track', async () => {
    const rodada = await f.rodada();
    const prog = await f.encounter(rodada.id, { track: 'progressao' });
    expect(
      await escrita(
        db.betMarket.create({ data: f.mercadoDeBossDados(prog, 'top_dps', { track: null }) }),
      ),
    ).toBe('check');
  });

  it('recusa mercado com track e sem roundEncounterId', async () => {
    const rodada = await f.rodada();
    expect(
      await escrita(
        db.betMarket.create({ data: f.mercadoWeeklyDados(rodada.id, { track: 'farm' }) }),
      ),
    ).toBe('check');
  });
});
