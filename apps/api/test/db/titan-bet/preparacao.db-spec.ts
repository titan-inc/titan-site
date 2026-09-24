import { randomInt, randomUUID } from 'node:crypto';
import { toCharacterKey, type PrepararRodada } from '@titan/shared';
import type { BlizzardService, RosterMember } from '../../../src/blizzard/blizzard.service';
import { CharactersRepository } from '../../../src/characters/characters.repository';
import { PrismaService } from '../../../src/prisma/prisma.service';
import {
  PreparacaoInvalida,
  PreparacaoRecusada,
  PreparacaoService,
} from '../../../src/titan-bet/preparacao.service';
import { ReadyService } from '../../../src/titan-bet/ready.service';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import type { RaidCatalog } from '../../../src/warcraftlogs/warcraftlogs.service';
import type { TeamCharacter, WowAuditService } from '../../../src/wowaudit/wowaudit.service';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * Preparação da semana no Officer Panel (D-45) — titan-bet-test-design.md
 * §3.14, T-G01–T-G08 e T-G10.
 *
 * Banco e repository reais; o WCL (catálogo) e a Blizzard (period corrente) são
 * dublês, porque a fonte não é o que está sob teste.
 */
jest.setTimeout(30_000);

const OFFICER = { userId: 'officer-teste', battletag: 'Officer#0001' };
const OUTRO = { userId: 'officer-dois', battletag: 'Officer#0002' };

/** Catálogo com uma raid de três bosses — ids longe de qualquer boss real. */
const CATALOGO: RaidCatalog = (() => {
  const zona = [
    { id: 990001, name: 'Boss Um', zoneId: 9901, zoneName: 'Raid de Teste', order: 0 },
    { id: 990002, name: 'Boss Dois', zoneId: 9901, zoneName: 'Raid de Teste', order: 1 },
    { id: 990003, name: 'Boss Três', zoneId: 9901, zoneName: 'Raid de Teste', order: 2 },
  ];
  return {
    encounters: new Map(zona.map((b) => [b.id, b])),
    zones: new Map([[9901, zona]]),
    difficultyNames: new Map([[5, 'Mythic']]),
  };
})();
const [UM, DOIS, TRES] = [990001, 990002, 990003];

describe('Titan Bet — preparação da semana (serviço + banco)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let repo: TitanBetRepository;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    repo = new TitanBetRepository(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Um period corrente que nenhum outro teste usa. */
  function servico(periodoCorrente = randomInt(100_000, 1_000_000_000)) {
    const blizzard = {
      getCurrentSeason: () => Promise.resolve({ currentPeriod: periodoCorrente }),
    };
    const wcl = { getRaidCatalog: () => Promise.resolve(CATALOGO) };
    return {
      periodoCorrente,
      prep: new PreparacaoService(repo, blizzard, wcl, { zonaAtual: () => Promise.resolve(null) }),
    };
  }

  /** Rodada em PREPARATION, criada direto — para os testes que não são da criação. */
  const emPreparacao = () => f.rodada({ cutoffAt: new Date(Date.now() + 48 * 60 * 60 * 1000) });

  const farm = (encounterId: number, mercados: PrepararRodada['encounters'][0]['mercados']) => ({
    encounterId,
    track: 'farm' as const,
    mercados,
  });

  describe('T-G01 — criar a rodada da próxima semana (D-45, §5.1)', () => {
    it('period = corrente + 1; cutoff numa terça 12:00 no fuso, no futuro; abertura antes', async () => {
      const { prep, periodoCorrente } = servico();
      const { roundId } = await prep.criar(OFFICER);

      const r = await db.betRound.findUniqueOrThrow({ where: { id: roundId } });
      expect(r.period).toBe(periodoCorrente + 1);
      expect(r.readyAt).toBeNull();
      expect(r.cutoffAt.getTime()).toBeGreaterThan(Date.now());
      expect(r.opensAt.getTime()).toBeLessThan(r.cutoffAt.getTime());
      const partes = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(r.cutoffAt);
      const parte = (t: string) => partes.find((p) => p.type === t)?.value;
      expect([parte('weekday'), parte('hour'), parte('minute'), parte('second')]).toEqual([
        'Tue',
        '12',
        '00',
        '00',
      ]);
    });

    it('quem criou fica registrado no BetEvent `rodada_criada` (D-11)', async () => {
      const { prep, periodoCorrente } = servico();
      const { roundId } = await prep.criar(OFFICER);
      const [evento, ...outros] = await db.betEvent.findMany({ where: { roundId } });
      expect(outros).toHaveLength(0);
      expect(evento).toMatchObject({
        type: 'rodada_criada',
        actorUserId: OFFICER.userId,
        actorBattletag: OFFICER.battletag,
        payload: { period: periodoCorrente + 1 },
      });
    });

    it('nasce sem encounter e sem mercado — quem escolhe é o officer', async () => {
      const { prep } = servico();
      const { roundId } = await prep.criar(OFFICER);
      expect(await db.betRoundEncounter.count({ where: { roundId } })).toBe(0);
      expect(await db.betMarket.count({ where: { roundId } })).toBe(0);
    });
  });

  describe('T-G02 — uma rodada por period', () => {
    it('criar de novo para o mesmo period é recusado, e nada muda', async () => {
      const { prep } = servico();
      const { roundId } = await prep.criar(OFFICER);
      const antes = await db.betRound.findUniqueOrThrow({ where: { id: roundId } });

      await expect(prep.criar(OUTRO)).rejects.toBeInstanceOf(PreparacaoRecusada);
      expect(await db.betRound.findUniqueOrThrow({ where: { id: roundId } })).toEqual(antes);
    });
  });

  describe('T-G03 — encounter só do catálogo de raid do WCL (D-22)', () => {
    it('id fora do catálogo → recusado, nada gravado', async () => {
      const rodada = await emPreparacao();
      await expect(
        servico().prep.salvar(
          rodada.id,
          { weekly: false, encounters: [farm(123456789, ['top_dps'])] },
          OFFICER,
        ),
      ).rejects.toBeInstanceOf(PreparacaoInvalida);
      expect(await db.betRoundEncounter.count({ where: { roundId: rodada.id } })).toBe(0);
    });

    it('do catálogo → gravado com nome e zona como o WCL escreve', async () => {
      const rodada = await emPreparacao();
      await servico().prep.salvar(
        rodada.id,
        { weekly: false, encounters: [farm(DOIS, ['top_dps'])] },
        OFFICER,
      );
      const [e] = await db.betRoundEncounter.findMany({ where: { roundId: rodada.id } });
      expect(e).toMatchObject({
        encounterId: DOIS,
        encounterName: 'Boss Dois',
        zoneName: 'Raid de Teste',
        track: 'farm',
        createdByUserId: OFFICER.userId,
      });
    });
  });

  describe('T-G04 — mercados por track (D-29)', () => {
    it('farm com os seis de boss; progressão com First Death', async () => {
      const rodada = await emPreparacao();
      const vista = await servico().prep.salvar(
        rodada.id,
        {
          weekly: false,
          encounters: [
            farm(UM, [
              'top_dps',
              'top_dps_parse',
              'top_hps',
              'top_hps_parse',
              'top_dispels',
              'first_death',
            ]),
            {
              encounterId: DOIS,
              track: 'progressao',
              mercados: ['first_death'],
            },
          ],
        },
        OFFICER,
      );
      const porBoss = Object.fromEntries(
        vista.encounters.map((e) => [e.encounterId, e.mercados.map((m) => m.kind).sort()]),
      );
      expect(porBoss[UM]).toHaveLength(6);
      expect(porBoss[DOIS]).toEqual(['first_death']);
      const mercados = await db.betMarket.findMany({ where: { roundId: rodada.id } });
      expect(mercados.filter((m) => m.track === 'progressao').map((m) => m.kind)).toEqual([
        'first_death',
      ]);
    });

    it('progressão com Top DPS, se passar do contrato, o service recusa', async () => {
      const rodada = await emPreparacao();
      await expect(
        servico().prep.salvar(
          rodada.id,
          {
            weekly: false,
            encounters: [
              {
                encounterId: DOIS,
                track: 'progressao',
                mercados: ['top_dps'],
              },
            ],
          },
          OFFICER,
        ),
      ).rejects.toBeInstanceOf(PreparacaoInvalida);
      expect(await db.betMarket.count({ where: { roundId: rodada.id } })).toBe(0);
    });
  });

  // Mudança de produto (D-54): substitui T-G05 ("a Weekly: um mercado e os
  // encounters marcados"). O officer não marca bosses: as opções da Weekly são os
  // encounters de progressão.
  describe('T-W15 — a Weekly é um mercado; as opções são os bosses de progressão', () => {
    it('Weekly ligada → um mercado da rodada, sem marcação de boss', async () => {
      const rodada = await emPreparacao();
      const vista = await servico().prep.salvar(
        rodada.id,
        {
          weekly: true,
          encounters: [
            farm(UM, ['top_dps']),
            { encounterId: DOIS, track: 'progressao', mercados: [] },
            { encounterId: TRES, track: 'progressao', mercados: ['first_death'] },
          ],
        },
        OFFICER,
      );
      const weekly = await db.betMarket.findMany({
        where: { roundId: rodada.id, kind: 'weekly_progression' },
      });
      expect(weekly).toHaveLength(1);
      expect(vista.weekly).toEqual({ marketId: weekly[0]!.id });
      expect(
        vista.encounters.filter((e) => e.track === 'progressao').map((e) => e.encounterId),
      ).toEqual([DOIS, TRES]);
    });

    it('desligar a Weekly apaga o mercado dela', async () => {
      const rodada = await emPreparacao();
      const { prep } = servico();
      const prog = { encounterId: UM, track: 'progressao' as const, mercados: [] };
      await prep.salvar(rodada.id, { weekly: true, encounters: [prog] }, OFFICER);
      const vista = await prep.salvar(rodada.id, { weekly: false, encounters: [prog] }, OFFICER);
      expect(vista.weekly).toBeNull();
      expect(
        await db.betMarket.count({ where: { roundId: rodada.id, kind: 'weekly_progression' } }),
      ).toBe(0);
    });
  });

  describe('T-G06 — salvar de novo substitui a configuração inteira', () => {
    it('tira um boss, troca track e mercados de outro; registra quem alterou', async () => {
      const rodada = await emPreparacao();
      const { prep } = servico();
      await prep.salvar(
        rodada.id,
        {
          weekly: false,
          encounters: [farm(UM, ['top_dps', 'first_death']), farm(DOIS, ['top_hps'])],
        },
        OFFICER,
      );
      const umAntes = await db.betRoundEncounter.findFirstOrThrow({
        where: { roundId: rodada.id, encounterId: UM },
      });

      const vista = await prep.salvar(
        rodada.id,
        {
          weekly: false,
          encounters: [
            {
              encounterId: UM,
              track: 'progressao',
              mercados: ['first_death'],
            },
          ],
        },
        OUTRO,
      );

      expect(vista.encounters.map((e) => [e.encounterId, e.track])).toEqual([[UM, 'progressao']]);
      const um = await db.betRoundEncounter.findFirstOrThrow({
        where: { roundId: rodada.id, encounterId: UM },
      });
      // O mesmo encounter, alterado — não apagado e recriado.
      expect(um.id).toBe(umAntes.id);
      expect(um).toMatchObject({
        createdByUserId: OFFICER.userId,
        updatedByUserId: OUTRO.userId,
        updatedByBattletag: OUTRO.battletag,
      });
      const mercados = await db.betMarket.findMany({ where: { roundId: rodada.id } });
      expect(mercados.map((m) => [m.kind, m.track])).toEqual([['first_death', 'progressao']]);
    });

    it('salvar a mesma configuração não muda nada nem registra alteração', async () => {
      const rodada = await emPreparacao();
      const { prep } = servico();
      const entrada = { weekly: false, encounters: [farm(UM, ['top_dps'])] };
      await prep.salvar(rodada.id, entrada, OFFICER);
      const antes = await db.betRoundEncounter.findMany({ where: { roundId: rodada.id } });
      await prep.salvar(rodada.id, entrada, OUTRO);
      expect(await db.betRoundEncounter.findMany({ where: { roundId: rodada.id } })).toEqual(antes);
    });
  });

  describe('T-G07 — só em PREPARATION (D-31)', () => {
    it('depois do Ready → recusado com motivo, configuração intacta', async () => {
      const rodada = await emPreparacao();
      const { prep } = servico();
      await prep.salvar(rodada.id, { weekly: false, encounters: [farm(UM, ['top_dps'])] }, OFFICER);
      await f.pronta(rodada.id);

      await expect(
        prep.salvar(rodada.id, { weekly: false, encounters: [] }, OFFICER),
      ).rejects.toBeInstanceOf(PreparacaoRecusada);
      expect(await db.betMarket.count({ where: { roundId: rodada.id } })).toBe(1);
    });

    it('cutoff vencido sem Ready → recusado: a rodada não abre mais', async () => {
      const rodada = await f.rodada({
        opensAt: new Date(Date.now() - 96 * 60 * 60 * 1000),
        cutoffAt: new Date(Date.now() - 60 * 60 * 1000),
      });
      await expect(
        servico().prep.salvar(rodada.id, { weekly: false, encounters: [] }, OFFICER),
      ).rejects.toBeInstanceOf(PreparacaoRecusada);
    });

    it('rodada inexistente → recusado', async () => {
      await expect(
        servico().prep.salvar('nao-existe', { weekly: false, encounters: [] }, OFFICER),
      ).rejects.toBeInstanceOf(PreparacaoRecusada);
    });
  });

  describe('T-G08 — cada salvamento vira BetEvent com o que mudou (§16.8)', () => {
    it('criados, alterados e removidos, com o officer', async () => {
      const rodada = await emPreparacao();
      const { prep } = servico();
      await prep.salvar(
        rodada.id,
        { weekly: false, encounters: [farm(UM, ['top_dps']), farm(DOIS, ['top_hps'])] },
        OFFICER,
      );
      await prep.salvar(
        rodada.id,
        {
          weekly: true,
          encounters: [
            // Sem a flag da Weekly (D-54), "alterado" é a troca de track.
            { encounterId: UM, track: 'progressao', mercados: ['first_death'] },
            farm(TRES, []),
          ],
        },
        OUTRO,
      );

      const eventos = await db.betEvent.findMany({
        where: { roundId: rodada.id, type: 'configuracao_salva' },
        orderBy: { id: 'asc' },
      });
      expect(eventos).toHaveLength(2);
      expect(eventos[1]).toMatchObject({
        actorUserId: OUTRO.userId,
        actorBattletag: OUTRO.battletag,
        payload: {
          encounters: { criados: [TRES], alterados: [UM], removidos: [DOIS] },
          mercados: {
            criados: [
              { encounterId: UM, kind: 'first_death' },
              { encounterId: null, kind: 'weekly_progression' },
            ],
            removidos: [
              { encounterId: UM, kind: 'top_dps' },
              { encounterId: DOIS, kind: 'top_hps' },
            ],
          },
        },
      });
    });

    it('salvar sem mudança não gera evento', async () => {
      const rodada = await emPreparacao();
      const { prep } = servico();
      const entrada = { weekly: false, encounters: [farm(UM, ['top_dps'])] };
      await prep.salvar(rodada.id, entrada, OFFICER);
      await prep.salvar(rodada.id, entrada, OFFICER);
      expect(
        await db.betEvent.count({ where: { roundId: rodada.id, type: 'configuracao_salva' } }),
      ).toBe(1);
    });
  });

  describe('T-G10 — preparar → Ready congela a configuração e os snapshots (D-31, D-45)', () => {
    it('o Ready captura bettors e candidatos sozinho; depois, nada da preparação muda', async () => {
      const { prep } = servico();
      const { roundId } = await prep.criar(OFFICER);
      await prep.salvar(
        roundId,
        {
          weekly: true,
          encounters: [
            farm(UM, ['top_dps']),
            { encounterId: DOIS, track: 'progressao', mercados: [] },
          ],
        },
        OFFICER,
      );

      const nome = `M${randomUUID().slice(0, 10)}`;
      const membro: RosterMember = {
        name: nome,
        nameKey: toCharacterKey(nome),
        realmSlug: 'azralon',
        rank: 4,
      };
      const titan: TeamCharacter = {
        name: nome,
        realm: 'Azralon',
        wowClass: 'Warrior',
        role: 'Melee',
      };
      const ready = new ReadyService(
        repo,
        new CharactersRepository(db),
        {
          getGuildRosterSnapshot: () =>
            Promise.resolve({ members: [membro], fetchedAt: Date.now(), stale: false }),
        } as unknown as BlizzardService,
        {
          getTeamCharactersSnapshot: () =>
            Promise.resolve({ characters: [titan], fetchedAt: Date.now(), stale: false }),
        } as unknown as WowAuditService,
      );
      await ready.ready(roundId, OFFICER);

      expect(await db.betRoundBettor.count({ where: { roundId } })).toBe(1);
      expect(await db.betRoundCandidate.findMany({ where: { roundId } })).toEqual([
        expect.objectContaining({ role: 'Melee' }),
      ]);
      await expect(
        prep.salvar(roundId, { weekly: false, encounters: [] }, OFFICER),
      ).rejects.toBeInstanceOf(PreparacaoRecusada);
      // E o banco segura mesmo sem o service (trigger titanbet_config_congelada).
      expect(await escrita(db.betMarket.deleteMany({ where: { roundId, kind: 'top_dps' } }))).toBe(
        'trigger',
      );
    });
  });
});
