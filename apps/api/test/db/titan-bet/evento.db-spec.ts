import { PrismaService } from '../../../src/prisma/prisma.service';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * T-E01 — BetEvent é append-only no banco (§16.4, D-39): é a trilha de
 * auditoria do que nenhuma outra estrutura registra.
 *
 * O TRUNCATE fica por último: sem o trigger, ele esvazia a tabela no titan_test.
 */
describe('Titan Bet — BetEvent (banco)', () => {
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

  async function evento() {
    const rodada = await f.rodada();
    return db.betEvent.create({
      data: {
        roundId: rodada.id,
        type: 'ready_falhou',
        actorUserId: 'officer-teste',
        actorBattletag: 'Officer#0001',
        payload: { motivo: 'teste' },
      },
    });
  }

  it('controle: um evento é gravado', async () => {
    expect(await escrita(evento())).toBe('aceito');
  });

  it('recusa UPDATE e DELETE de evento', async () => {
    const e = await evento();
    expect(
      await escrita(
        db.betEvent.update({ where: { id: e.id }, data: { payload: { motivo: 'x' } } }),
      ),
    ).toBe('trigger');
    expect(await escrita(db.betEvent.delete({ where: { id: e.id } }))).toBe('trigger');
  });

  it('recusa TRUNCATE', async () => {
    await evento();
    expect(await escrita(db.$executeRawUnsafe('TRUNCATE "BetEvent"'))).toBe('trigger');
  });
});
