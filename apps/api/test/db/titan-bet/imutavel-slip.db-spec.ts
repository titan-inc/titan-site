import { PrismaService } from '../../../src/prisma/prisma.service';
import { Ciclo, esperarPassar } from './ciclo';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * RED-M2C — o slip e as apostas depois do "Submeter pagamento" e do cutoff
 * (D-27, D-34, D-35). Ver docs/specs/titan-bet-test-design.md §3.2, §3.3, §3.13.
 *
 * Os casos de cutoff usam uma rodada com cutoff poucos segundos à frente e
 * esperam o relógio do Postgres passar — tempo pelo dado, sem bypass.
 */
jest.setTimeout(30_000);

/** Cutoff curto: dá tempo de montar a rodada e o slip antes dele. */
const CUTOFF_CURTO_MS = 4_000;

describe('Titan Bet — imutabilidade do slip e das apostas (banco)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let ciclo: Ciclo;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    ciclo = new Ciclo(db, f);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  const dadosDeValido = {
    validatedAt: new Date(),
    validatedByUserId: 'officer-teste',
    validatedByBattletag: 'Officer#0001',
  };
  const dadosDeRecusado = {
    rejectedAt: new Date(),
    rejectedByUserId: 'officer-teste',
    rejectedByBattletag: 'Officer#0001',
    rejectionReason: 'motivo',
  };

  describe('T-S04 — aposta só muda com o slip em rascunho (D-27)', () => {
    it('controle: em rascunho, as apostas — inclusive a da Weekly — mudam', async () => {
      const r = await ciclo.aberta();
      const { slip, aposta } = await ciclo.slipComAposta(r);
      expect(await escrita(db.bet.update({ where: { id: aposta.id }, data: { stake: 700 } }))).toBe(
        'aceito',
      );
      const weekly = await db.bet.create({
        data: {
          slipId: slip.id,
          roundId: r.rodada.id,
          marketId: r.weekly.id,
          marketKind: 'weekly_progression',
          stake: 300,
          targetEncounterId: r.prog.id,
          targetEncounterTrack: 'progressao',
        },
      });
      expect(await escrita(db.bet.update({ where: { id: weekly.id }, data: { stake: 400 } }))).toBe(
        'aceito',
      );
      expect(await escrita(db.bet.delete({ where: { id: aposta.id } }))).toBe('aceito');
    });

    it('recusa criar, alterar e apagar aposta de slip submetido', async () => {
      const r = await ciclo.aberta();
      const { slip, aposta } = await ciclo.slipComAposta(r);
      await ciclo.submeter(slip);
      expect(
        await escrita(
          db.bet.create({
            data: {
              slipId: slip.id,
              roundId: r.rodada.id,
              marketId: r.weekly.id,
              marketKind: 'weekly_progression',
              stake: 300,
              targetEncounterId: r.prog.id,
              targetEncounterTrack: 'progressao',
            },
          }),
        ),
      ).toBe('trigger');
      expect(await escrita(db.bet.update({ where: { id: aposta.id }, data: { stake: 700 } }))).toBe(
        'trigger',
      );
      expect(await escrita(db.bet.delete({ where: { id: aposta.id } }))).toBe('trigger');
    });

    // Mudança de produto (D-54): o caso "recusa criar e apagar seleção da Weekly
    // de slip submetido" saiu com a tabela de seleções. A aposta da Weekly é uma
    // Bet como as outras, coberta pelo caso acima.
  });

  describe('T-S05 / T-S19 / T-S23 / T-S25 — só as transições da §16.5', () => {
    it('controle: rascunho → aguardando → válido, e aguardando → recusado', async () => {
      const r = await ciclo.aberta();
      const a = await f.slip(r.rodada.id, r.dono.id, 'rascunho', { ownerUserId: 'a' });
      expect(await escrita(ciclo.submeter(a))).toBe('aceito');
      expect(await escrita(ciclo.confirmar(a.id))).toBe('aceito');

      const b = await f.slip(r.rodada.id, r.dono.id, 'rascunho', { ownerUserId: 'b' });
      await ciclo.submeter(b);
      expect(await escrita(ciclo.recusar(b.id))).toBe('aceito');
    });

    it('T-S05: recusado é terminal', async () => {
      const r = await ciclo.aberta();
      const slip = await f.slip(r.rodada.id, r.dono.id);
      await ciclo.submeter(slip);
      await ciclo.recusar(slip.id);
      const para = (data: object) => db.betSlip.update({ where: { id: slip.id }, data });

      expect(await escrita(para({ status: 'rascunho' }))).toBe('trigger');
      expect(await escrita(para({ status: 'aguardando_deposito' }))).toBe('trigger');
      expect(await escrita(para({ status: 'valido', ...dadosDeValido }))).toBe('trigger');
      expect(await escrita(para({ status: 'expirado', expiredAt: new Date() }))).toBe('trigger');
    });

    it('T-S19: expirado é terminal', async () => {
      const r = await ciclo.aberta();
      const slip = await f.slip(r.rodada.id, r.dono.id);
      await ciclo.expirar(slip.id);
      const para = (data: object) => db.betSlip.update({ where: { id: slip.id }, data });
      const submetido = {
        submittedAt: new Date(),
        expectedTotal: 500,
        depositCharacterId: r.dono.id,
      };

      expect(await escrita(para({ status: 'rascunho' }))).toBe('trigger');
      expect(await escrita(para({ status: 'aguardando_deposito', ...submetido }))).toBe('trigger');
      expect(await escrita(para({ status: 'valido', ...submetido, ...dadosDeValido }))).toBe(
        'trigger',
      );
      expect(await escrita(para({ status: 'recusado', ...submetido, ...dadosDeRecusado }))).toBe(
        'trigger',
      );
    });

    it('T-S23: válido não muda de estado', async () => {
      const r = await ciclo.aberta();
      const slip = await f.slip(r.rodada.id, r.dono.id);
      await ciclo.submeter(slip);
      await ciclo.confirmar(slip.id);
      const para = (data: object) => db.betSlip.update({ where: { id: slip.id }, data });

      expect(await escrita(para({ status: 'rascunho' }))).toBe('trigger');
      expect(await escrita(para({ status: 'aguardando_deposito' }))).toBe('trigger');
      expect(await escrita(para({ status: 'recusado', ...dadosDeRecusado }))).toBe('trigger');
      expect(await escrita(para({ status: 'expirado', expiredAt: new Date() }))).toBe('trigger');
    });

    it('T-S25: rascunho não pula o Submeter pagamento', async () => {
      const r = await ciclo.aberta();
      const submetido = {
        submittedAt: new Date(),
        expectedTotal: 500,
        depositCharacterId: r.dono.id,
      };
      const a = await f.slip(r.rodada.id, r.dono.id, 'rascunho', { ownerUserId: 'a' });
      expect(
        await escrita(
          db.betSlip.update({
            where: { id: a.id },
            data: { status: 'valido', ...submetido, ...dadosDeValido },
          }),
        ),
      ).toBe('trigger');
      const b = await f.slip(r.rodada.id, r.dono.id, 'rascunho', { ownerUserId: 'b' });
      expect(
        await escrita(
          db.betSlip.update({
            where: { id: b.id },
            data: { status: 'recusado', ...submetido, ...dadosDeRecusado },
          }),
        ),
      ).toBe('trigger');
    });
  });

  describe('T-S24 — o que o Submeter congela não muda (D-27)', () => {
    it('recusa mudar total, depositante e data de submissão de slip submetido', async () => {
      const r = await ciclo.aberta();
      const slip = await f.slip(r.rodada.id, r.dono.id);
      await ciclo.submeter(slip);
      const muda = (data: object) => db.betSlip.update({ where: { id: slip.id }, data });

      expect(await escrita(muda({ expectedTotal: 900 }))).toBe('trigger');
      expect(await escrita(muda({ depositCharacterId: r.candidatos.Tank }))).toBe('trigger');
      expect(await escrita(muda({ submittedAt: new Date(Date.now() - 60_000) }))).toBe('trigger');
    });

    it('recusa reescrever quem confirmou e quando', async () => {
      const r = await ciclo.aberta();
      const slip = await f.slip(r.rodada.id, r.dono.id);
      await ciclo.submeter(slip);
      await ciclo.confirmar(slip.id);
      const muda = (data: object) => db.betSlip.update({ where: { id: slip.id }, data });

      expect(await escrita(muda({ validatedByUserId: 'outro' }))).toBe('trigger');
      expect(await escrita(muda({ validatedAt: new Date(Date.now() - 60_000) }))).toBe('trigger');
    });
  });

  describe('T-S07 / T-S06 / T-D04 — o cutoff encerra as ações de aposta (D-35, D-07)', () => {
    it('T-S07: depois do cutoff não se cria slip, não se edita rascunho, não se submete', async () => {
      const r = await ciclo.aberta(CUTOFF_CURTO_MS);
      const { slip, aposta } = await ciclo.slipComAposta(r);
      await esperarPassar(db, r.rodada.cutoffAt);

      expect(
        await escrita(f.slip(r.rodada.id, r.dono.id, 'rascunho', { ownerUserId: 'nova' })),
      ).toBe('trigger');
      expect(await escrita(db.bet.update({ where: { id: aposta.id }, data: { stake: 800 } }))).toBe(
        'trigger',
      );
      expect(
        await escrita(
          db.bet.create({
            data: {
              slipId: slip.id,
              roundId: r.rodada.id,
              marketId: r.weekly.id,
              marketKind: 'weekly_progression',
              stake: 300,
              targetEncounterId: r.prog.id,
              targetEncounterTrack: 'progressao',
            },
          }),
        ),
      ).toBe('trigger');
      expect(await escrita(ciclo.submeter(slip))).toBe('trigger');
      // Controle: o que o cutoff faz com o rascunho é expirá-lo.
      expect(await escrita(ciclo.expirar(slip.id))).toBe('aceito');
    });

    it('T-S06: depois da recusa, novo slip só antes do cutoff', async () => {
      const r = await ciclo.aberta(CUTOFF_CURTO_MS);
      const slip = await f.slip(r.rodada.id, r.dono.id);
      await ciclo.submeter(slip);
      await ciclo.recusar(slip.id);
      await esperarPassar(db, r.rodada.cutoffAt);
      expect(await escrita(f.slip(r.rodada.id, r.dono.id))).toBe('trigger');
    });

    it('controle T-S06: antes do cutoff, novo slip depois da recusa é aceito', async () => {
      const r = await ciclo.aberta();
      const slip = await f.slip(r.rodada.id, r.dono.id);
      await ciclo.submeter(slip);
      await ciclo.recusar(slip.id);
      expect(await escrita(f.slip(r.rodada.id, r.dono.id))).toBe('aceito');
    });

    it('T-D04: depois do cutoff não se confirma nem recusa; pendente expira', async () => {
      const r = await ciclo.aberta(CUTOFF_CURTO_MS);
      const a = await f.slip(r.rodada.id, r.dono.id, 'rascunho', { ownerUserId: 'a' });
      const b = await f.slip(r.rodada.id, r.dono.id, 'rascunho', { ownerUserId: 'b' });
      await ciclo.submeter(a);
      await ciclo.submeter(b);
      await esperarPassar(db, r.rodada.cutoffAt);

      expect(await escrita(ciclo.confirmar(a.id))).toBe('trigger');
      expect(await escrita(ciclo.recusar(b.id))).toBe('trigger');
      // Controle: pendente vira expirado no cutoff.
      expect(await escrita(ciclo.expirar(a.id))).toBe('aceito');
    });
  });
});
