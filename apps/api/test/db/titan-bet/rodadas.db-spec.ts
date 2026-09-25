import {
  rodadaDoMembroSchema,
  rodadasDoMembroSchema,
  rodadasDoOfficerSchema,
  slipsSubmetidosSchema,
} from '@titan/shared';
import { randomUUID } from 'node:crypto';
import { CharactersRepository } from '../../../src/characters/characters.repository';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ApostasService } from '../../../src/titan-bet/apostas.service';
import { DepositoService } from '../../../src/titan-bet/deposito.service';
import { ElegibilidadeService } from '../../../src/titan-bet/elegibilidade.service';
import { RodadasService } from '../../../src/titan-bet/rodadas.service';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import { Ciclo } from './ciclo';
import { depositante, Fabrica } from './fabrica';

/**
 * F0 — os contratos de leitura do front (titan-bet-test-design.md §34.1):
 * T-C01, T-C02, T-C04 e T-C05. O `titan_test` acumula rodadas de outras suítes,
 * então cada caso confere as rodadas que ele mesmo criou, nunca a lista inteira.
 */
jest.setTimeout(30_000);

const OFFICER = { userId: 'officer-teste', battletag: 'Officer#0001' };

describe('Titan Bet — rodadas para o front (serviço + banco)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let ciclo: Ciclo;
  let repo: TitanBetRepository;
  let rodadas: RodadasService;
  let apostas: ApostasService;
  let deposito: DepositoService;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    ciclo = new Ciclo(db, f);
    repo = new TitanBetRepository(db);
    const elegibilidade = new ElegibilidadeService(repo);
    rodadas = new RodadasService(repo, elegibilidade);
    apostas = new ApostasService(repo, elegibilidade, new CharactersRepository(db));
    deposito = new DepositoService(repo);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Conta com um personagem no snapshot da rodada e um alt fora dele. */
  async function apostador(principal: string) {
    const user = await db.user.create({
      data: { battlenetId: randomUUID(), battletag: 'Apostador#1', membership: 'member' },
    });
    const alt = await f.personagem();
    await db.guildCharacter.create({ data: { userId: user.id, characterId: principal, rank: 5 } });
    await db.guildCharacter.create({ data: { userId: user.id, characterId: alt.id, rank: 7 } });
    return { conta: { userId: user.id, battletag: user.battletag }, alt };
  }

  const ids = (lista: { rodadas: Array<{ roundId: string }> }) =>
    lista.rodadas.map((r) => r.roundId);

  describe('T-C01 — as rodadas visíveis à conta', () => {
    it('membro: as publicadas (com Ready), com a fase; preparação não aparece', async () => {
      const aberta = await ciclo.aberta();
      const preparando = await ciclo.preparacao();

      const lista = await rodadas.visiveis('qualquer-conta', true);
      expect(rodadasDoMembroSchema.parse(lista)).toEqual(lista);
      expect(ids(lista)).toContain(aberta.rodada.id);
      expect(ids(lista)).not.toContain(preparando.id);
      expect(lista.rodadas.find((r) => r.roundId === aberta.rodada.id)).toMatchObject({
        fase: 'OPEN',
        cutoffAt: aberta.rodada.cutoffAt.toISOString(),
      });
    });

    it('a mais recente primeiro (pelo cutoff)', async () => {
      const antiga = await ciclo.aberta(24 * 60 * 60 * 1000);
      const nova = await ciclo.aberta(6 * 24 * 60 * 60 * 1000);
      const lista = ids(await rodadas.visiveis('qualquer-conta', true));
      expect(lista.indexOf(nova.rodada.id)).toBeLessThan(lista.indexOf(antiga.rodada.id));
    });

    it('fora da guilda: só as rodadas em que a conta tem slip (D-53a)', async () => {
      const comSlip = await ciclo.aberta();
      const semSlip = await ciclo.aberta();
      const quemSaiu = `saiu-${randomUUID()}`;
      await ciclo.slipComAposta(comSlip, quemSaiu);

      const lista = ids(await rodadas.visiveis(quemSaiu, false));
      expect(lista).toEqual([comSlip.rodada.id]);
      expect(lista).not.toContain(semSlip.rodada.id);
    });
  });

  describe('T-C02 — o cardápio da rodada', () => {
    it('mercados com o boss legível, bosses de progressão e candidatos com nome e role', async () => {
      const r = await ciclo.aberta();
      const { conta } = await apostador(r.dono.id);

      const cardapio = await rodadas.daRodada(r.rodada.id, conta.userId);
      expect(rodadaDoMembroSchema.parse(cardapio)).toEqual(cardapio);
      expect(cardapio).toMatchObject({ roundId: r.rodada.id, fase: 'OPEN' });

      const encounter = await db.betRoundEncounter.findUniqueOrThrow({ where: { id: r.farm.id } });
      expect(cardapio!.mercados).toEqual(
        expect.arrayContaining([
          {
            marketId: r.topDispels.id,
            kind: 'top_dispels',
            boss: {
              roundEncounterId: r.farm.id,
              encounterName: encounter.encounterName,
              track: 'farm',
            },
          },
          { marketId: r.weekly.id, kind: 'weekly_progression', boss: null },
        ]),
      );
      expect(cardapio!.bossesDeProgressao.map((b) => b.roundEncounterId)).toEqual([r.prog.id]);

      const tank = await db.character.findUniqueOrThrow({ where: { id: r.candidatos.Tank } });
      expect(cardapio!.candidatos).toContainEqual({
        characterId: tank.id,
        name: tank.name,
        realm: tank.realm,
        role: 'Tank',
      });
    });

    it('bettor na rodada aberta pode apostar; os próprios personagens vêm listados (D-56)', async () => {
      const r = await ciclo.aberta();
      const { conta, alt } = await apostador(r.dono.id);
      const cardapio = await rodadas.daRodada(r.rodada.id, conta.userId);
      expect(cardapio!.podeApostar).toBe(true);
      expect([...cardapio!.personagensDoApostador].sort()).toEqual([r.dono.id, alt.id].sort());
    });

    it('membro fora do snapshot vê o cardápio, mas não pode apostar (D-53b)', async () => {
      const r = await ciclo.aberta();
      const fora = await db.user.create({
        data: { battlenetId: randomUUID(), battletag: 'Fora#1', membership: 'member' },
      });
      const cardapio = await rodadas.daRodada(r.rodada.id, fora.id);
      expect(cardapio!.mercados.length).toBeGreaterThan(0);
      expect(cardapio!.podeApostar).toBe(false);
      expect(cardapio!.personagensDoApostador).toEqual([]);
    });

    it('ex-membro com slip continua podendo apostar na rodada aberta (D-68)', async () => {
      const r = await ciclo.aberta();
      const { conta } = await apostador(r.dono.id);
      await apostas.salvar(r.rodada.id, conta, {
        apostas: [{ marketId: r.topDispels.id, stake: 300, targetCharacterId: r.candidatos.Tank }],
      });
      await db.guildCharacter.deleteMany({ where: { userId: conta.userId } });

      const cardapio = await rodadas.daRodada(r.rodada.id, conta.userId);
      expect(cardapio!.podeApostar).toBe(true);
      expect(cardapio!.personagensDoApostador).toEqual([r.dono.id]);
    });

    it('rodada ainda em preparação não é publicada → null', async () => {
      const preparando = await ciclo.preparacao();
      expect(await rodadas.daRodada(preparando.id, 'qualquer-conta')).toBeNull();
      expect(await rodadas.daRodada('nao-existe', 'qualquer-conta')).toBeNull();
    });
  });

  describe('T-C04 — as rodadas do Officer Panel', () => {
    it('D-73: podeAuditar e auditavelDesde vêm da mesma regra dos serviços', async () => {
      // Cutoff terça 22/09 12:00 BRT → a auditoria abre quinta 24/09 23:30 BRT.
      const cutoffAt = new Date('2026-09-22T15:00:00Z');
      const rodada = await f.rodada({
        cutoffAt,
        readyAt: new Date(cutoffAt.getTime() - 60 * 60 * 1000),
        readyByUserId: 'officer-teste',
        readyByBattletag: 'Officer#0001',
      });
      const naHora = (iso: string) =>
        new RodadasService(repo, new ElegibilidadeService(repo), () => new Date(iso));

      const antes = (await naHora('2026-09-25T02:29:00Z').doOfficer()).rodadas.find(
        (r) => r.roundId === rodada.id,
      );
      expect(antes).toMatchObject({
        fase: 'BETTING_CLOSED',
        podeAuditar: false,
        auditavelDesde: '2026-09-25T02:30:00.000Z',
      });
      const depois = (await naHora('2026-09-25T02:30:00Z').doOfficer()).rodadas.find(
        (r) => r.roundId === rodada.id,
      );
      expect(depois).toMatchObject({ fase: 'BETTING_CLOSED', podeAuditar: true });
    });

    it('todas, inclusive em preparação, com a fase e o Ready', async () => {
      const aberta = await ciclo.aberta();
      const preparando = await ciclo.preparacao();

      const lista = await rodadas.doOfficer();
      expect(rodadasDoOfficerSchema.parse(lista)).toEqual(lista);
      expect(lista.rodadas.find((r) => r.roundId === preparando.id)).toMatchObject({
        fase: 'PREPARATION',
        readyAt: null,
      });
      expect(lista.rodadas.find((r) => r.roundId === aberta.rodada.id)).toMatchObject({
        fase: 'OPEN',
        readyByBattletag: expect.any(String) as unknown,
      });
    });
  });

  describe('T-C05 — os slips submetidos da rodada, sem as escolhas', () => {
    it('submetidos em qualquer estado; rascunho fica de fora; nenhuma aposta', async () => {
      const r = await ciclo.aberta();
      const { conta } = await apostador(r.dono.id);
      const { slipId } = await apostas.salvar(r.rodada.id, conta, {
        apostas: [{ marketId: r.topDispels.id, stake: 300, targetCharacterId: r.candidatos.Tank }],
      });
      const dono = await db.character.findUniqueOrThrow({ where: { id: r.dono.id } });
      await apostas.submeter(r.rodada.id, conta, depositante(dono));
      await deposito.confirmar(slipId, OFFICER);
      const rascunho = await ciclo.slipComAposta(r, 'outra-conta');

      const lista = await deposito.submetidos(r.rodada.id);
      expect(slipsSubmetidosSchema.parse(lista)).toEqual(lista);
      expect(lista.slips).toEqual([
        {
          slipId,
          ownerBattletag: conta.battletag,
          status: 'valido',
          depositCharacter: { name: dono.name, realm: dono.realm },
          expectedTotal: 300,
          submittedAt: expect.any(String) as unknown,
          // D-77: o depósito deste foi confirmado.
          depositoConfirmado: true,
        },
      ]);
      expect(lista.slips.map((s) => s.slipId)).not.toContain(rascunho.slip.id);
    });
  });
});
