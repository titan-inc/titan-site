import { randomUUID } from 'node:crypto';
import { toCharacterKey } from '@titan/shared';
import type { BlizzardService, RosterMember } from '../../../src/blizzard/blizzard.service';
import { CharactersRepository } from '../../../src/characters/characters.repository';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ElegibilidadeService } from '../../../src/titan-bet/elegibilidade.service';
import { ReadyRecusado, ReadyService } from '../../../src/titan-bet/ready.service';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import type { TeamCharacter, WowAuditService } from '../../../src/wowaudit/wowaudit.service';
import { Fabrica } from './fabrica';

/**
 * Workflow do Ready (D-31, D-32, D-33, D-38) — titan-bet-test-design.md §3.1,
 * §3.13 e §7 ("RED/GREEN Ready").
 *
 * Banco, repository, identidade de personagem e triggers são os reais. Só as
 * duas fontes externas são dublês: o roster da Blizzard e o Titan Roster.
 */
const OFFICER = { userId: 'officer-teste', battletag: 'Officer#0001' };

function membro(rank: number, realmSlug = 'azralon'): RosterMember {
  const name = `M${randomUUID().slice(0, 10)}`;
  return { name, nameKey: toCharacterKey(name), realmSlug, rank };
}

function titan(role: string, realm = 'Azralon'): TeamCharacter {
  return { name: `T${randomUUID().slice(0, 10)}`, realm, wowClass: 'Warrior', role };
}

function blizzard(members: RosterMember[], stale = false) {
  return {
    getGuildRosterSnapshot: () => Promise.resolve({ members, fetchedAt: Date.now(), stale }),
  } as unknown as BlizzardService;
}

function wowaudit(characters: TeamCharacter[], stale = false) {
  return {
    getTeamCharactersSnapshot: () => Promise.resolve({ characters, fetchedAt: Date.now(), stale }),
  } as unknown as WowAuditService;
}

describe('Titan Bet — Ready (serviço + banco)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let repo: TitanBetRepository;
  let characters: CharactersRepository;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    repo = new TitanBetRepository(db);
    characters = new CharactersRepository(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  const servico = (roster: BlizzardService, time: WowAuditService) =>
    new ReadyService(repo, characters, roster, time);

  /** Rodada em PREPARATION com um boss farm, Top Dispels e a Weekly. */
  async function rodadaConfigurada(cutoffEmMs = 48 * 60 * 60 * 1000) {
    const rodada = await f.rodada({ cutoffAt: new Date(Date.now() + cutoffEmMs) });
    const boss = await f.encounter(rodada.id);
    await f.mercadoDeBoss(boss, 'top_dispels');
    await f.mercadoWeekly(rodada.id);
    return rodada;
  }

  async function estadoDaRodada(roundId: string) {
    const [rodada, bettors, candidatos, eventos] = await Promise.all([
      db.betRound.findUniqueOrThrow({ where: { id: roundId } }),
      db.betRoundBettor.count({ where: { roundId } }),
      db.betRoundCandidate.count({ where: { roundId } }),
      db.betEvent.findMany({ where: { roundId } }),
    ]);
    return { rodada, bettors, candidatos, eventos };
  }

  describe('T-R04 / T-B01 — bettors = personagens do roster no Ready, sem exigir login', () => {
    it('grava todo personagem do roster, com rank, e ninguém de fora dele', async () => {
      const rodada = await rodadaConfigurada();
      const [comConta, semConta, outro] = [membro(3), membro(7), membro(1, 'area-52')];
      const user = await db.user.create({
        data: { battlenetId: randomUUID(), battletag: 'Logou#1', membership: 'member' },
      });
      await db.guildCharacter.create({
        data: {
          userId: user.id,
          rank: 3,
          characterId: await characters.resolverDoRoster({
            name: comConta.name,
            realm: comConta.realmSlug,
          }),
        },
      });
      const fora = titan('Heal'); // candidato, mas fora do roster da guilda

      await servico(blizzard([comConta, semConta, outro]), wowaudit([fora])).ready(
        rodada.id,
        OFFICER,
      );

      const bettors = await db.betRoundBettor.findMany({
        where: { roundId: rodada.id },
        include: { character: true },
      });
      expect(bettors.map((b) => [b.character.nameKey, b.rank]).sort()).toEqual(
        [
          [comConta.nameKey, 3],
          [semConta.nameKey, 7],
          [outro.nameKey, 1],
        ].sort(),
      );
      expect(bettors.some((b) => b.character.nameKey === toCharacterKey(fora.name))).toBe(false);

      const { rodada: pronta } = await estadoDaRodada(rodada.id);
      expect(pronta.readyAt).not.toBeNull();
      expect(pronta.readyByUserId).toBe(OFFICER.userId);
      expect(pronta.readyByBattletag).toBe(OFFICER.battletag);
      expect(pronta.bettorSourceFetchedAt).not.toBeNull();
    });
  });

  describe('T-R05 — candidatos = Titan Roster no Ready, com a role', () => {
    it('grava cada personagem do Titan Roster com a role do momento', async () => {
      const rodada = await rodadaConfigurada();
      const time = [titan('Tank'), titan('Heal'), titan('Melee', 'Area 52'), titan('Ranged')];

      await servico(blizzard([membro(5)]), wowaudit(time)).ready(rodada.id, OFFICER);

      const candidatos = await db.betRoundCandidate.findMany({
        where: { roundId: rodada.id },
        include: { character: true },
      });
      expect(candidatos.map((c) => [c.character.nameKey, c.role]).sort()).toEqual(
        time.map((t) => [toCharacterKey(t.name), t.role]).sort(),
      );
      const { rodada: pronta } = await estadoDaRodada(rodada.id);
      expect(pronta.candidateSourceFetchedAt).not.toBeNull();
    });
  });

  describe('T-R06 — Ready atômico: qualquer falha deixa a rodada em PREPARATION', () => {
    async function recusadoSemRastro(
      roundId: string,
      roster: BlizzardService,
      time: WowAuditService,
    ) {
      await expect(servico(roster, time).ready(roundId, OFFICER)).rejects.toBeInstanceOf(
        ReadyRecusado,
      );
      const estado = await estadoDaRodada(roundId);
      expect(estado.rodada.readyAt).toBeNull();
      expect(estado.bettors).toBe(0);
      expect(estado.candidatos).toBe(0);
      // A tentativa fica registrada — é o único rastro de um Ready atômico que falhou.
      expect(estado.eventos).toHaveLength(1);
      expect(estado.eventos[0]).toMatchObject({
        type: 'ready_falhou',
        actorUserId: OFFICER.userId,
        actorBattletag: OFFICER.battletag,
      });
      expect(typeof (estado.eventos[0]?.payload as { motivo?: unknown }).motivo).toBe('string');
    }

    it('roster da Blizzard vindo do cache velho', async () => {
      const rodada = await rodadaConfigurada();
      await recusadoSemRastro(rodada.id, blizzard([membro(5)], true), wowaudit([titan('Tank')]));
    });

    it('Titan Roster vindo do cache velho', async () => {
      const rodada = await rodadaConfigurada();
      await recusadoSemRastro(rodada.id, blizzard([membro(5)]), wowaudit([titan('Tank')], true));
    });

    it('roster da guilda vazio', async () => {
      const rodada = await rodadaConfigurada();
      await recusadoSemRastro(rodada.id, blizzard([]), wowaudit([titan('Tank')]));
    });

    it('Titan Roster vazio', async () => {
      const rodada = await rodadaConfigurada();
      await recusadoSemRastro(rodada.id, blizzard([membro(5)]), wowaudit([]));
    });

    it('role do Titan Roster que não é Tank, Melee, Heal nem Ranged', async () => {
      const rodada = await rodadaConfigurada();
      await recusadoSemRastro(rodada.id, blizzard([membro(5)]), wowaudit([titan('DPS')]));
    });

    it('Weekly Progression sem nenhum boss marcado para ela', async () => {
      const rodada = await f.rodada();
      await f.encounter(rodada.id, { inWeeklyProgression: false });
      await f.mercadoWeekly(rodada.id);
      await recusadoSemRastro(rodada.id, blizzard([membro(5)]), wowaudit([titan('Tank')]));
    });

    it('erro no meio da gravação desfaz tudo', async () => {
      const rodada = await rodadaConfigurada();
      const repetido = membro(5);
      // O mesmo personagem duas vezes no roster viola o unique do snapshot no
      // meio da transação — o que já foi gravado antes dele tem de sumir.
      await recusadoSemRastro(
        rodada.id,
        blizzard([membro(3), repetido, repetido]),
        wowaudit([titan('Tank')]),
      );
    });
  });

  describe('T-R07 — Ready só antes do cutoff (D-31)', () => {
    it('recusa Ready de rodada cujo cutoff passou', async () => {
      const rodada = await f.rodada({ cutoffAt: new Date(Date.now() - 60_000) });
      await expect(
        servico(blizzard([membro(5)]), wowaudit([titan('Tank')])).ready(rodada.id, OFFICER),
      ).rejects.toBeInstanceOf(ReadyRecusado);
      expect((await estadoDaRodada(rodada.id)).rodada.readyAt).toBeNull();
    });
  });

  describe('T-B02 / T-K01 — nada redefine a rodada depois do Ready (D-32, D-33)', () => {
    it('segundo Ready é recusado e não acrescenta bettor nem muda candidato', async () => {
      const rodada = await rodadaConfigurada();
      const cura = titan('Heal');
      await servico(blizzard([membro(5)]), wowaudit([cura])).ready(rodada.id, OFFICER);

      // Depois do Ready: entra alguém na guilda e a role muda no WoWAudit.
      await expect(
        servico(blizzard([membro(5), membro(2)]), wowaudit([{ ...cura, role: 'Ranged' }])).ready(
          rodada.id,
          OFFICER,
        ),
      ).rejects.toBeInstanceOf(ReadyRecusado);

      const estado = await estadoDaRodada(rodada.id);
      expect(estado.bettors).toBe(1);
      const [candidato] = await db.betRoundCandidate.findMany({ where: { roundId: rodada.id } });
      expect(candidato?.role).toBe('Heal');
    });
  });

  describe('T-R10 / T-R11 — elegibilidade da conta pelo snapshot (D-38)', () => {
    async function conta(personagens: RosterMember[]) {
      const user = await db.user.create({
        data: { battlenetId: randomUUID(), battletag: 'Conta#1', membership: 'member' },
      });
      for (const p of personagens) {
        await db.guildCharacter.create({
          data: {
            userId: user.id,
            rank: p.rank,
            characterId: await characters.resolverDoRoster({ name: p.name, realm: p.realmSlug }),
          },
        });
      }
      return user;
    }

    it('T-R10: primeiro login depois do Ready associa a conta ao snapshot, sem mudá-lo', async () => {
      const rodada = await rodadaConfigurada();
      const pj = membro(4);
      await servico(blizzard([pj, membro(6)]), wowaudit([titan('Tank')])).ready(rodada.id, OFFICER);
      const antes = (await estadoDaRodada(rodada.id)).bettors;

      const user = await conta([pj]); // a conta só passa a existir agora
      const elegivel = await new ElegibilidadeService(repo).personagemDeElegibilidade(
        rodada.id,
        user.id,
      );

      const esperado = await characters.buscar({ name: pj.name, realm: pj.realmSlug });
      expect(elegivel).toBe(esperado?.id);
      expect((await estadoDaRodada(rodada.id)).bettors).toBe(antes);
    });

    it('T-R11: conta sem personagem no snapshot não é elegível', async () => {
      const rodada = await rodadaConfigurada();
      await servico(blizzard([membro(5)]), wowaudit([titan('Tank')])).ready(rodada.id, OFFICER);

      const user = await conta([membro(5)]); // personagem que não estava no roster do Ready
      expect(
        await new ElegibilidadeService(repo).personagemDeElegibilidade(rodada.id, user.id),
      ).toBeNull();
    });

    it('com vários personagens no snapshot, vale o de melhor rank', async () => {
      const rodada = await rodadaConfigurada();
      const [alt, main] = [membro(7), membro(4)];
      await servico(blizzard([alt, main]), wowaudit([titan('Tank')])).ready(rodada.id, OFFICER);

      const user = await conta([alt, main]);
      const esperado = await characters.buscar({ name: main.name, realm: main.realmSlug });
      expect(
        await new ElegibilidadeService(repo).personagemDeElegibilidade(rodada.id, user.id),
      ).toBe(esperado?.id);
    });
  });
});
