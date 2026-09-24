import { randomUUID } from 'node:crypto';
import { CharactersRepository } from '../../../src/characters/characters.repository';
import { PrismaService } from '../../../src/prisma/prisma.service';
import {
  ApostaRecusada,
  ApostasService,
  ContaNaoElegivel,
} from '../../../src/titan-bet/apostas.service';
import { CutoffService } from '../../../src/titan-bet/cutoff.service';
import { DepositoRecusado, DepositoService } from '../../../src/titan-bet/deposito.service';
import { ElegibilidadeService } from '../../../src/titan-bet/elegibilidade.service';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import { slipDoOfficerSchema, slipsSubmetidosSchema } from '@titan/shared';
import { Ciclo, esperarPassar } from './ciclo';
import { depositante, Fabrica } from './fabrica';

/**
 * Milestone "RED/GREEN Apostas" — Salvar, Submeter, depósito e cutoff
 * (D-02, D-27, D-28, D-34, D-35, D-09, D-53, D-55, D-56, D-57). titan-bet-test-design.md §3.2,
 * §3.3, §3.18, §7.
 */
jest.setTimeout(30_000);

const OFFICER = { userId: 'officer-teste', battletag: 'Officer#0001' };

describe('Titan Bet — apostas e depósito (serviço + banco)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let ciclo: Ciclo;
  let repo: TitanBetRepository;
  let apostas: ApostasService;
  let deposito: DepositoService;
  let cutoff: CutoffService;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    ciclo = new Ciclo(db, f);
    repo = new TitanBetRepository(db);
    apostas = new ApostasService(
      repo,
      new ElegibilidadeService(repo),
      new CharactersRepository(db),
    );
    deposito = new DepositoService(repo);
    cutoff = new CutoffService(repo);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /**
   * Rodada aberta montada no ciclo de vida: mercados em PREPARATION, snapshots,
   * Ready. A conta tem um personagem no snapshot (que também é candidato Melee)
   * e um alt da guilda fora do snapshot (candidato Ranged). `cura` é candidato e
   * não é de ninguém.
   */
  async function cenario(cutoffEmMs = 48 * 60 * 60 * 1000) {
    const rodada = await f.rodada({ cutoffAt: new Date(Date.now() + cutoffEmMs) });
    const boss = await f.encounter(rodada.id);
    const topDps = await f.mercadoDeBoss(boss, 'top_dps');
    const firstDeath = await f.mercadoDeBoss(boss, 'first_death');
    const prog = await f.encounter(rodada.id, { track: 'progressao' });
    const weekly = await f.mercadoWeekly(rodada.id);

    const main = await f.personagem();
    const alt = await f.personagem();
    const cura = await f.personagem();
    await f.bettor(rodada.id, main.id);
    await f.candidato(rodada.id, main.id, 'Melee');
    await f.candidato(rodada.id, cura.id, 'Heal');
    // O alt da conta, fora do snapshot de apostadores, é candidato (D-56).
    await f.candidato(rodada.id, alt.id, 'Ranged');
    await f.pronta(rodada.id);

    const user = await db.user.create({
      data: { battlenetId: randomUUID(), battletag: 'Apostador#1', membership: 'member' },
    });
    for (const [pj, rank] of [
      [main, 5],
      [alt, 7],
    ] as const) {
      await db.guildCharacter.create({ data: { userId: user.id, characterId: pj.id, rank } });
    }
    const conta = { userId: user.id, battletag: user.battletag };
    return { rodada, boss, prog, topDps, firstDeath, weekly, main, alt, cura, conta };
  }

  const slipsDa = (roundId: string, userId: string) =>
    db.betSlip.findMany({ where: { roundId, ownerUserId: userId }, include: { bets: true } });

  describe('T-S01 — Salvar cria o slip e depois reusa o mesmo (D-27)', () => {
    it('duas vezes Salvar = um slip em rascunho, com as apostas da última', async () => {
      const c = await cenario();
      const primeiro = await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
      });
      const segundo = await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [
          { marketId: c.topDps.id, stake: 700, targetCharacterId: c.main.id },
          { marketId: c.firstDeath.id, stake: 200, targetCharacterId: c.cura.id },
          { marketId: c.weekly.id, stake: 400, encounterId: c.prog.id },
        ],
      });

      expect(segundo.slipId).toBe(primeiro.slipId);
      const [slip, ...outros] = await slipsDa(c.rodada.id, c.conta.userId);
      expect(outros).toHaveLength(0);
      expect(slip?.status).toBe('rascunho');
      expect(slip?.eligibilityCharacterId).toBe(c.main.id);
      expect(slip?.bets.map((b) => [b.marketKind, b.stake]).sort()).toEqual(
        [
          ['first_death', 200],
          ['top_dps', 700],
          ['weekly_progression', 400],
        ].sort(),
      );
      // A Weekly aposta num boss de progressão (D-54).
      const weekly = slip?.bets.find((b) => b.marketKind === 'weekly_progression');
      expect(weekly?.targetEncounterId).toBe(c.prog.id);
    });

    it('Salvar remove apostas que saíram do rascunho', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.weekly.id, stake: 400, encounterId: c.prog.id }],
      });
      await apostas.salvar(c.rodada.id, c.conta, { apostas: [] });
      const [slip] = await slipsDa(c.rodada.id, c.conta.userId);
      expect(slip?.status).toBe('rascunho');
      expect(slip?.bets).toHaveLength(0);
    });

    it('recusa alvo que não é candidato na role do mercado', async () => {
      const c = await cenario();
      await expect(
        apostas.salvar(c.rodada.id, c.conta, {
          apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.cura.id }],
        }),
      ).rejects.toBeInstanceOf(ApostaRecusada);
    });
  });

  describe('T-W10 — só boss de progressão é opção da Weekly (D-54)', () => {
    it('Weekly num boss farm → recusada, nada gravado', async () => {
      const c = await cenario();
      await expect(
        apostas.salvar(c.rodada.id, c.conta, {
          apostas: [{ marketId: c.weekly.id, stake: 400, encounterId: c.boss.id }],
        }),
      ).rejects.toBeInstanceOf(ApostaRecusada);
      expect(await slipsDa(c.rodada.id, c.conta.userId)).toHaveLength(0);
    });

    it('Weekly num boss que não é da rodada → recusada', async () => {
      const c = await cenario();
      const outra = await cenario();
      await expect(
        apostas.salvar(c.rodada.id, c.conta, {
          apostas: [{ marketId: c.weekly.id, stake: 400, encounterId: outra.prog.id }],
        }),
      ).rejects.toBeInstanceOf(ApostaRecusada);
    });
  });

  describe('T-S16 — elegibilidade e depositante são da conta (D-02, D-38)', () => {
    it('conta fora do snapshot não salva', async () => {
      const c = await cenario();
      const estranho = await db.user.create({
        data: { battlenetId: randomUUID(), battletag: 'Fora#1', membership: 'member' },
      });
      await expect(
        apostas.salvar(
          c.rodada.id,
          { userId: estranho.id, battletag: estranho.battletag },
          { apostas: [] },
        ),
      ).rejects.toBeInstanceOf(ApostaRecusada);
      expect(await slipsDa(c.rodada.id, estranho.id)).toHaveLength(0);
    });

    // Mudança de produto (D-55): "depositante que não é da conta é recusado" e
    // "o alt da conta pode ser o depositante" saíram — qualquer personagem pode
    // depositar, e a conferência é do officer. Ver T-S26.
  });

  describe('T-S26 — qualquer personagem deposita, informado por nome + realm (D-55)', () => {
    it('personagem que o site nunca viu: aceito, identidade criada e congelada no slip', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
      });
      const nome = `Dep${Date.now() % 1_000_000}`;
      await apostas.submeter(c.rodada.id, c.conta, {
        depositCharacter: { name: nome, realm: 'Area 52' },
      });

      const [slip] = await slipsDa(c.rodada.id, c.conta.userId);
      expect(slip?.status).toBe('aguardando_deposito');
      const pj = await db.character.findUniqueOrThrow({ where: { id: slip!.depositCharacterId! } });
      expect(pj).toMatchObject({ name: nome, realm: 'Area 52', realmKey: 'area52' });
      expect(await db.guildCharacter.count({ where: { characterId: pj.id } })).toBe(0);
    });

    it('personagem de outra pessoa também é aceito: quem confere é o officer', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
      });
      await apostas.submeter(c.rodada.id, c.conta, depositante(c.cura));
      const [slip] = await slipsDa(c.rodada.id, c.conta.userId);
      expect(slip?.depositCharacterId).toBe(c.cura.id);
    });

    it('resolve pela identidade da Regra 6: caixa do nome e do realm não criam outra', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
      });
      await apostas.submeter(c.rodada.id, c.conta, {
        depositCharacter: { name: c.alt.name.toUpperCase(), realm: 'AZRALON' },
      });
      const [slip] = await slipsDa(c.rodada.id, c.conta.userId);
      expect(slip?.depositCharacterId).toBe(c.alt.id);
    });

    it('o acento distingue pessoas (Regra 6): variação acentuada é outra identidade', async () => {
      const c = await cenario();
      const base = `Shr${Date.now() % 100_000}ewd`;
      const semAcento = await db.character.create({
        data: { nameKey: base.toLowerCase(), realmKey: 'azralon', name: base, realm: 'Azralon' },
      });
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
      });
      await apostas.submeter(c.rodada.id, c.conta, {
        depositCharacter: { name: base.replace('ewd', 'ëwd'), realm: 'Azralon' },
      });
      const [slip] = await slipsDa(c.rodada.id, c.conta.userId);
      expect(slip?.depositCharacterId).not.toBe(semAcento.id);
    });

    it('o dono vê o depositante como informou, com nome e realm', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
      });
      await apostas.submeter(c.rodada.id, c.conta, depositante(c.cura));
      const meu = await apostas.meuSlip(c.rodada.id, c.conta.userId);
      expect(meu?.depositCharacter).toEqual({ name: c.cura.name, realm: c.cura.realm });
    });
  });

  describe('T-S03 — Submeter pagamento congela o slip (D-27)', () => {
    it('muda para aguardando_deposito com total = Σ stakes, depositante e data', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [
          { marketId: c.topDps.id, stake: 700, targetCharacterId: c.main.id },
          { marketId: c.weekly.id, stake: 250, encounterId: c.prog.id },
        ],
      });
      await apostas.submeter(c.rodada.id, c.conta, depositante(c.main));

      const [slip] = await slipsDa(c.rodada.id, c.conta.userId);
      expect(slip?.status).toBe('aguardando_deposito');
      expect(slip?.expectedTotal).toBe(950);
      expect(slip?.depositCharacterId).toBe(c.main.id);
      expect(slip?.submittedAt).not.toBeNull();
    });

    it('depois do submit, Salvar é recusado e nada muda', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 700, targetCharacterId: c.main.id }],
      });
      await apostas.submeter(c.rodada.id, c.conta, depositante(c.main));

      await expect(apostas.salvar(c.rodada.id, c.conta, { apostas: [] })).rejects.toBeInstanceOf(
        ApostaRecusada,
      );
      const [slip] = await slipsDa(c.rodada.id, c.conta.userId);
      expect(slip?.bets).toHaveLength(1);
    });

    it('recusa submeter slip sem nenhuma aposta', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, { apostas: [] });
      await expect(
        apostas.submeter(c.rodada.id, c.conta, depositante(c.main)),
      ).rejects.toBeInstanceOf(ApostaRecusada);
    });
  });

  // Mudança de produto (D-56): substitui o T-S15, que só recusava o First Death
  // no próprio depositante, e só no Submeter. Agora vale para qualquer
  // personagem reconhecido como do apostador, no Salvar e no Submeter.
  describe('T-S27 — First Death em personagem do apostador é recusado (D-56)', () => {
    it('Salvar: no personagem de elegibilidade → recusado, nada gravado', async () => {
      const c = await cenario();
      await expect(
        apostas.salvar(c.rodada.id, c.conta, {
          apostas: [{ marketId: c.firstDeath.id, stake: 300, targetCharacterId: c.main.id }],
        }),
      ).rejects.toBeInstanceOf(ApostaRecusada);
      expect(await slipsDa(c.rodada.id, c.conta.userId)).toHaveLength(0);
    });

    it('Salvar: num alt ligado à conta, fora do snapshot → recusado', async () => {
      const c = await cenario();
      await expect(
        apostas.salvar(c.rodada.id, c.conta, {
          apostas: [{ marketId: c.firstDeath.id, stake: 300, targetCharacterId: c.alt.id }],
        }),
      ).rejects.toBeInstanceOf(ApostaRecusada);
    });

    it('Submeter: o depositante informado passa a ser do apostador → recusado', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.firstDeath.id, stake: 300, targetCharacterId: c.cura.id }],
      });
      await expect(
        apostas.submeter(c.rodada.id, c.conta, depositante(c.cura)),
      ).rejects.toBeInstanceOf(ApostaRecusada);
      const [slip] = await slipsDa(c.rodada.id, c.conta.userId);
      expect(slip?.status).toBe('rascunho');
    });

    it('Submeter: alt ligado à conta depois do Salvar → recusado', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.firstDeath.id, stake: 300, targetCharacterId: c.cura.id }],
      });
      await db.guildCharacter.create({
        data: { userId: c.conta.userId, characterId: c.cura.id, rank: 7 },
      });
      await expect(
        apostas.submeter(c.rodada.id, c.conta, depositante(c.alt)),
      ).rejects.toBeInstanceOf(ApostaRecusada);
    });

    it('controle: First Death em quem não é do apostador, com depositante próprio', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.firstDeath.id, stake: 300, targetCharacterId: c.cura.id }],
      });
      await apostas.submeter(c.rodada.id, c.conta, depositante(c.alt));
      const [slip] = await slipsDa(c.rodada.id, c.conta.userId);
      expect(slip?.status).toBe('aguardando_deposito');
    });

    it('controle: Top DPS no próprio personagem é permitido (D-09)', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
      });
      await apostas.submeter(c.rodada.id, c.conta, depositante(c.main));
      const [slip] = await slipsDa(c.rodada.id, c.conta.userId);
      expect(slip?.status).toBe('aguardando_deposito');
    });
  });

  /** A revalidação de membership: o `GuildCharacter` some e a conta vira não-membro. */
  async function saiDaGuilda(userId: string) {
    await db.guildCharacter.deleteMany({ where: { userId } });
    await db.user.update({ where: { id: userId }, data: { membership: 'not_member' } });
  }

  describe('T-Z10 — quem sai da guilda mantém a própria rodada e aposta (D-53a, D-65)', () => {
    it('o guard reconhece a conta pela posse de slip nesta rodada — e só nesta', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
      });
      const outra = await f.rodada();
      expect(await repo.contaTemSlipNaRodada(c.rodada.id, c.conta.userId)).toBe(true);
      expect(await repo.contaTemSlipNaRodada(outra.id, c.conta.userId)).toBe(false);
    });

    it('com rascunho: vê, edita e submete depois de sair', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
      });
      await saiDaGuilda(c.conta.userId);

      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 500, targetCharacterId: c.main.id }],
      });
      await apostas.submeter(c.rodada.id, c.conta, depositante(c.main));
      const meu = await apostas.meuSlip(c.rodada.id, c.conta.userId);
      expect(meu).toMatchObject({ status: 'aguardando_deposito', expectedTotal: 500 });
    });

    it('o self-bet continua valendo: o de elegibilidade do slip segue sendo dele (D-56)', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
      });
      await saiDaGuilda(c.conta.userId);
      await expect(
        apostas.salvar(c.rodada.id, c.conta, {
          apostas: [{ marketId: c.firstDeath.id, stake: 300, targetCharacterId: c.main.id }],
        }),
      ).rejects.toBeInstanceOf(ApostaRecusada);
    });

    it('slip recusado também é posse: começa outro, com a mesma elegibilidade', async () => {
      const c = await cenario();
      const { slipId } = await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
      });
      await apostas.submeter(c.rodada.id, c.conta, depositante(c.main));
      await deposito.recusar(slipId, OFFICER, 'valor diferente');
      await saiDaGuilda(c.conta.userId);

      const novo = await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
      });
      expect(novo.slipId).not.toBe(slipId);
      const slip = await db.betSlip.findUniqueOrThrow({ where: { id: novo.slipId } });
      expect(slip.eligibilityCharacterId).toBe(c.main.id);
    });

    it('limite (D-53a): quem sai antes de ter slip não começa um', async () => {
      const c = await cenario();
      await saiDaGuilda(c.conta.userId);
      await expect(
        apostas.salvar(c.rodada.id, c.conta, {
          apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
        }),
      ).rejects.toBeInstanceOf(ContaNaoElegivel);
      expect(await repo.contaTemSlipNaRodada(c.rodada.id, c.conta.userId)).toBe(false);
    });
  });

  describe('T-Z09 — "ver slip" do officer: como foi submetido, e o acesso registrado (D-57)', () => {
    async function submetido() {
      const c = await cenario();
      const { slipId } = await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [
          { marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id },
          { marketId: c.weekly.id, stake: 200, encounterId: c.prog.id },
        ],
      });
      await apostas.submeter(c.rodada.id, c.conta, depositante(c.cura));
      return { c, slipId };
    }
    const eventosDe = (roundId: string) =>
      db.betEvent.findMany({
        where: { roundId, type: 'slip_visualizado' },
        orderBy: { id: 'asc' },
      });

    it('o slip inteiro, no contrato estrito, com os alvos legíveis', async () => {
      const { c, slipId } = await submetido();
      const visto = await deposito.verSlip(slipId, OFFICER);

      expect(slipDoOfficerSchema.parse(visto)).toEqual(visto);
      expect(visto).toMatchObject({
        slipId,
        roundId: c.rodada.id,
        status: 'aguardando_deposito',
        ownerBattletag: c.conta.battletag,
        eligibilityCharacter: { name: c.main.name, realm: c.main.realm },
        depositCharacter: { name: c.cura.name, realm: c.cura.realm },
        expectedTotal: 500,
      });
      expect(visto!.apostas).toEqual([
        {
          marketId: c.topDps.id,
          marketKind: 'top_dps',
          stake: 300,
          alvo: { characterId: c.main.id, name: c.main.name, realm: c.main.realm },
        },
        {
          marketId: c.weekly.id,
          marketKind: 'weekly_progression',
          stake: 200,
          boss: { roundEncounterId: c.prog.id, encounterName: c.prog.encounterName },
        },
      ]);
    });

    it('cada acesso vira um BetEvent, com o officer e o horário', async () => {
      const { c, slipId } = await submetido();
      await deposito.verSlip(slipId, OFFICER);
      await deposito.verSlip(slipId, OFFICER);

      const eventos = await eventosDe(c.rodada.id);
      expect(eventos).toHaveLength(2);
      expect(eventos[0]).toMatchObject({
        actorUserId: OFFICER.userId,
        actorBattletag: OFFICER.battletag,
        payload: { slipId },
      });
      expect(eventos[0]!.createdAt).toBeInstanceOf(Date);
    });

    it('só leitura: o slip e as apostas não mudam', async () => {
      const { slipId } = await submetido();
      const antes = await db.betSlip.findUniqueOrThrow({
        where: { id: slipId },
        include: { bets: true },
      });
      await deposito.verSlip(slipId, OFFICER);
      const depois = await db.betSlip.findUniqueOrThrow({
        where: { id: slipId },
        include: { bets: true },
      });
      expect(depois).toEqual(antes);
    });

    it('rascunho não foi submetido: recusado, sem registro', async () => {
      const c = await cenario();
      const { slipId } = await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
      });
      await expect(deposito.verSlip(slipId, OFFICER)).rejects.toBeInstanceOf(DepositoRecusado);
      expect(await eventosDe(c.rodada.id)).toHaveLength(0);
    });

    it('slip inexistente → null, sem registro', async () => {
      expect(await deposito.verSlip('nao-existe', OFFICER)).toBeNull();
    });
  });

  describe('T-S18 — concorrência (§10)', () => {
    it('dois submits ao mesmo tempo: um passa, o outro é recusado', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
      });
      const r = await Promise.allSettled([
        apostas.submeter(c.rodada.id, c.conta, depositante(c.main)),
        apostas.submeter(c.rodada.id, c.conta, depositante(c.alt)),
      ]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const [slip] = await slipsDa(c.rodada.id, c.conta.userId);
      expect(slip?.status).toBe('aguardando_deposito');
    });
  });

  describe('T-D02 — confirmar depósito (R-15, §16.6)', () => {
    it('válido, com officer e horário, e o lançamento deposito_validado na mesma operação', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 600, targetCharacterId: c.main.id }],
      });
      await apostas.submeter(c.rodada.id, c.conta, depositante(c.main));
      const [pendente] = await slipsDa(c.rodada.id, c.conta.userId);

      await deposito.confirmar(pendente!.id, OFFICER);

      const slip = await db.betSlip.findUniqueOrThrow({ where: { id: pendente!.id } });
      expect(slip.status).toBe('valido');
      expect(slip.validatedByUserId).toBe(OFFICER.userId);
      expect(slip.validatedAt).not.toBeNull();
      const ledger = await db.goldLedgerEntry.findMany({ where: { slipId: slip.id } });
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({
        kind: 'deposito_validado',
        account: 'membro',
        amount: 600,
        actorUserId: OFFICER.userId,
      });
    });

    it('dois confirms ao mesmo tempo: um passa, um lançamento só', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 600, targetCharacterId: c.main.id }],
      });
      await apostas.submeter(c.rodada.id, c.conta, depositante(c.main));
      const [pendente] = await slipsDa(c.rodada.id, c.conta.userId);

      const r = await Promise.allSettled([
        deposito.confirmar(pendente!.id, OFFICER),
        deposito.confirmar(pendente!.id, OFFICER),
      ]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(r.find((x) => x.status === 'rejected')).toMatchObject({
        reason: expect.any(DepositoRecusado) as unknown,
      });
      expect(await db.goldLedgerEntry.count({ where: { slipId: pendente!.id } })).toBe(1);
    });
  });

  describe('T-D03 — recusar depósito (D-34)', () => {
    it('recusado com officer e motivo, sem lançamento; a conta abre um slip novo', async () => {
      const c = await cenario();
      const { slipId } = await apostas.salvar(c.rodada.id, c.conta, {
        apostas: [{ marketId: c.topDps.id, stake: 600, targetCharacterId: c.main.id }],
      });
      await apostas.submeter(c.rodada.id, c.conta, depositante(c.main));

      await deposito.recusar(slipId, OFFICER, 'depósito de 500, não de 600');

      const recusado = await db.betSlip.findUniqueOrThrow({ where: { id: slipId } });
      expect(recusado.status).toBe('recusado');
      expect(recusado.rejectionReason).toBe('depósito de 500, não de 600');
      expect(recusado.rejectedByUserId).toBe(OFFICER.userId);
      expect(await db.goldLedgerEntry.count({ where: { slipId } })).toBe(0);

      const novo = await apostas.salvar(c.rodada.id, c.conta, { apostas: [] });
      expect(novo.slipId).not.toBe(slipId);
      expect((await db.betSlip.findUniqueOrThrow({ where: { id: slipId } })).status).toBe(
        'recusado',
      );
    });

    it('só se recusa slip aguardando depósito', async () => {
      const c = await cenario();
      const { slipId } = await apostas.salvar(c.rodada.id, c.conta, { apostas: [] });
      await expect(deposito.recusar(slipId, OFFICER, 'x')).rejects.toBeInstanceOf(DepositoRecusado);
    });
  });

  describe('T-S08 — job de cutoff (D-07, D-35)', () => {
    it('expira rascunho e pendente vencidos, preserva válido e recusado, e é idempotente', async () => {
      const r = await ciclo.aberta(4_000);
      const [rascunho, pendente, valido, recusado] = await Promise.all(
        ['a', 'b', 'c', 'd'].map((dono) =>
          f.slip(r.rodada.id, r.dono.id, 'rascunho', { ownerUserId: dono }),
        ),
      );
      await ciclo.submeter(pendente!);
      await ciclo.submeter(valido!);
      await ciclo.confirmar(valido!.id);
      await ciclo.submeter(recusado!);
      await ciclo.recusar(recusado!.id);

      const aberta = await ciclo.aberta(); // outra rodada, cutoff longe
      const intacto = await f.slip(aberta.rodada.id, aberta.dono.id);

      await esperarPassar(db, r.rodada.cutoffAt);
      await cutoff.expirarVencidos();
      await cutoff.expirarVencidos(); // idempotente

      const status = async (id: string) =>
        (await db.betSlip.findUniqueOrThrow({ where: { id } })).status;
      expect(await status(rascunho!.id)).toBe('expirado');
      expect(await status(pendente!.id)).toBe('expirado');
      expect(await status(valido!.id)).toBe('valido');
      expect(await status(recusado!.id)).toBe('recusado');
      expect(await status(intacto.id)).toBe('rascunho');
    });

    it('T-S28 — rascunho expirado nunca foi submetido: lista e "ver slip" funcionam, sem data inventada (D-71)', async () => {
      const r = await ciclo.aberta(4_000);
      const { slip: rascunho } = await ciclo.slipComAposta(r, 'conta-rascunho');
      const { slip: pendente } = await ciclo.slipComAposta(r, 'conta-pendente');
      await ciclo.submeter(pendente);

      await esperarPassar(db, r.rodada.cutoffAt);
      await cutoff.expirarVencidos();

      const gravado = await db.betSlip.findUniqueOrThrow({ where: { id: rascunho.id } });
      expect(gravado.status).toBe('expirado');
      expect(gravado.submittedAt).toBeNull();

      const lista = await deposito.submetidos(r.rodada.id);
      expect(slipsSubmetidosSchema.parse(lista)).toEqual(lista);
      expect(lista.slips.find((s) => s.slipId === rascunho.id)).toMatchObject({
        status: 'expirado',
        submittedAt: null,
        depositCharacter: null,
        expectedTotal: null,
      });
      // O submetido que expirou pendente continua com a data e o total.
      expect(lista.slips.find((s) => s.slipId === pendente.id)).toMatchObject({
        status: 'expirado',
        submittedAt: expect.any(String) as unknown,
        expectedTotal: 500,
      });

      const visto = await deposito.verSlip(rascunho.id, OFFICER);
      expect(slipDoOfficerSchema.parse(visto)).toEqual(visto);
      expect(visto).toMatchObject({
        status: 'expirado',
        submittedAt: null,
        depositCharacter: null,
        expectedTotal: null,
        expiredAt: expect.any(String) as unknown,
      });
      expect(visto!.apostas).toHaveLength(1);

      const vistoPendente = await deposito.verSlip(pendente.id, OFFICER);
      expect(vistoPendente!.submittedAt).toEqual(expect.any(String));
    });

    it('depois do cutoff, Salvar é recusado', async () => {
      const c = await cenario(4_000);
      await apostas.salvar(c.rodada.id, c.conta, { apostas: [] });
      await esperarPassar(db, c.rodada.cutoffAt);
      await expect(
        apostas.salvar(c.rodada.id, c.conta, {
          apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.main.id }],
        }),
      ).rejects.toBeInstanceOf(ApostaRecusada);
    });
  });
});
