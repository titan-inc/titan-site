import { randomInt, randomUUID } from 'node:crypto';
import { closingReportSchema, toCharacterKey } from '@titan/shared';
import type { BlizzardService, RosterMember } from '../../../src/blizzard/blizzard.service';
import { CharactersRepository } from '../../../src/characters/characters.repository';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ApostasService } from '../../../src/titan-bet/apostas.service';
import { AuditoriaService } from '../../../src/titan-bet/auditoria.service';
import { CalculoService } from '../../../src/titan-bet/calculo.service';
import { ClosingRepository } from '../../../src/titan-bet/closing.repository';
import { ClosingService } from '../../../src/titan-bet/closing.service';
import { DepositoService } from '../../../src/titan-bet/deposito.service';
import { ElegibilidadeService } from '../../../src/titan-bet/elegibilidade.service';
import type { LeituraDoReport } from '../../../src/titan-bet/leitura-wcl';
import { PreparacaoService } from '../../../src/titan-bet/preparacao.service';
import { ReadyService } from '../../../src/titan-bet/ready.service';
import { LedgerService, SettlementService } from '../../../src/titan-bet/settlement.service';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import type { RaidCatalog } from '../../../src/warcraftlogs/warcraftlogs.service';
import type { TeamCharacter, WowAuditService } from '../../../src/wowaudit/wowaudit.service';
import { esperarPassar, depoisDaQuinta } from './ciclo';
import { depositante, Fabrica } from './fabrica';

/**
 * T-E01 — um fluxo, do começo ao fim (titan-bet-test-design.md §3.11):
 * preparar a semana → Ready → Salvar → Submeter → confirmar depósito → cutoff
 * → Auditar → calcular → confirmar → pagar → Closing Report.
 *
 * Todos os serviços e o banco são os reais (`titan_test`); só as fontes
 * externas são dublês — roster da Blizzard, Titan Roster e WCL.
 */
jest.setTimeout(120_000);

const OFFICER = { userId: 'officer-e2e', battletag: 'Officer#0001' };
const BOSS = 770001;
const PROG = 770002;
const CATALOGO: RaidCatalog = {
  encounters: new Map([
    [BOSS, { id: BOSS, name: 'Boss E2E', zoneId: 77, zoneName: 'Raid E2E', order: 0 }],
    [PROG, { id: PROG, name: 'Prog E2E', zoneId: 77, zoneName: 'Raid E2E', order: 1 }],
  ]),
  zones: new Map(),
  difficultyNames: new Map(),
};

describe('Titan Bet — E2E (T-E01)', () => {
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

  it('a semana inteira, com o dinheiro fechando e o relatório publicado', async () => {
    const nome = (p: string) => `${p}${randomUUID().slice(0, 6)}`;
    const [ana, bia, candA, candB] = [nome('Ana'), nome('Bia'), nome('Aa'), nome('Bb')];
    const elegibilidade = new ElegibilidadeService(repo);
    const apostas = new ApostasService(repo, elegibilidade, new CharactersRepository(db));
    const deposito = new DepositoService(repo);

    // 1. Preparar a semana (D-45).
    const rodada = await f.rodada({ cutoffAt: new Date(Date.now() + 30_000) });
    const prep = new PreparacaoService(
      repo,
      { getCurrentSeason: () => Promise.resolve({ currentPeriod: randomInt(1, 1_000_000) }) },
      { getRaidCatalog: () => Promise.resolve(CATALOGO) },
      { zonaAtual: () => Promise.resolve(null) },
    );
    const vista = await prep.salvar(
      rodada.id,
      {
        weekly: true,
        encounters: [
          { encounterId: BOSS, track: 'farm', mercados: ['top_dps', 'first_death'] },
          // A opção da Weekly é o boss de progressão (D-54).
          { encounterId: PROG, track: 'progressao', mercados: [] },
        ],
      },
      OFFICER,
    );
    const boss = vista.encounters[0]!;
    const prog = vista.encounters[1]!;
    const topDps = boss.mercados.find((m) => m.kind === 'top_dps')!.marketId;
    const weekly = vista.weekly!.marketId;

    // 2. Ready: bettors do roster, candidatos do Titan Roster (D-31).
    const membro = (n: string): RosterMember => ({
      name: n,
      nameKey: toCharacterKey(n),
      realmSlug: 'azralon',
      rank: 5,
    });
    const time = (n: string, role: string): TeamCharacter => ({
      name: n,
      realm: 'Azralon',
      wowClass: 'Warrior',
      role,
    });
    await new ReadyService(
      repo,
      new CharactersRepository(db),
      {
        getGuildRosterSnapshot: () =>
          Promise.resolve({
            members: [ana, bia, candA, candB].map(membro),
            fetchedAt: Date.now(),
            stale: false,
          }),
      } as unknown as BlizzardService,
      {
        getTeamCharactersSnapshot: () =>
          Promise.resolve({
            characters: [time(candA, 'Melee'), time(candB, 'Ranged')],
            fetchedAt: Date.now(),
            stale: false,
          }),
      } as unknown as WowAuditService,
    ).ready(rodada.id, OFFICER);

    // As contas logam depois do Ready e se associam aos personagens (D-38).
    const conta = async (n: string) => {
      const pj = await db.character.findFirstOrThrow({
        where: { nameKey: toCharacterKey(n), realmKey: 'azralon' },
      });
      const user = await db.user.create({
        data: { battlenetId: randomUUID(), battletag: `${n}#1`, membership: 'member' },
      });
      await db.guildCharacter.create({ data: { userId: user.id, characterId: pj.id, rank: 5 } });
      return { userId: user.id, battletag: user.battletag, pj: pj.id, dep: depositante(pj) };
    };
    const [contaAna, contaBia] = [await conta(ana), await conta(bia)];
    const idDe = async (n: string) =>
      (
        await db.character.findFirstOrThrow({
          where: { nameKey: toCharacterKey(n), realmKey: 'azralon' },
        })
      ).id;
    const [idA, idB] = [await idDe(candA), await idDe(candB)];

    // 3. Salvar, Submeter pagamento, confirmar depósito.
    const slipAna = await apostas.salvar(rodada.id, contaAna, {
      apostas: [
        { marketId: topDps, stake: 600, targetCharacterId: idA },
        { marketId: weekly, stake: 300, encounterId: prog.roundEncounterId },
      ],
    });
    expect(await apostas.submeter(rodada.id, contaAna, contaAna.dep)).toEqual({
      total: 900,
    });
    const slipBia = await apostas.salvar(rodada.id, contaBia, {
      apostas: [{ marketId: topDps, stake: 400, targetCharacterId: idB }],
    });
    await apostas.submeter(rodada.id, contaBia, contaBia.dep);
    await deposito.confirmar(slipAna.slipId, OFFICER);
    await deposito.confirmar(slipBia.slipId, OFFICER);

    // 4. Cutoff e Auditar: um titanbet* na terça e um na quinta (D-30).
    await esperarPassar(db, rodada.cutoffAt);
    const terca = rodada.cutoffAt.getTime() + 1_000;
    const quinta = terca + 2 * 24 * 60 * 60 * 1000;
    // O que o WCL responde: a kill na terça — A com mais dano; a quinta sem o boss.
    const reports: Record<string, LeituraDoReport> = {
      E2ETerca: {
        code: 'E2ETerca',
        startTime: terca,
        revision: 4,
        fights: [
          { id: 1, encounterID: BOSS, difficulty: 5, kill: true, startTime: 0, endTime: 300_000 },
          {
            id: 2,
            encounterID: PROG,
            difficulty: 5,
            kill: true,
            startTime: 400_000,
            endTime: 600_000,
          },
        ],
        actors: [
          { id: 1, name: candA, server: 'Azralon' },
          { id: 2, name: candB, server: 'Azralon' },
        ],
        deaths: [{ fight: 1, targetID: 2, timestamp: 50_000 }],
        kills: {
          1: {
            damage: [
              { id: 1, name: candA, total: 30_000_000 },
              { id: 2, name: candB, total: 20_000_000 },
            ],
            healing: [],
            dispels: { entries: [] },
            rankingsDps: [],
            rankingsHps: [],
          },
          2: {
            damage: [],
            healing: [],
            dispels: { entries: [] },
            rankingsDps: [],
            rankingsHps: [],
          },
        },
      },
      E2EQuinta: {
        code: 'E2EQuinta',
        revision: 2,
        startTime: quinta,
        fights: [],
        actors: [],
        deaths: [],
        kills: {},
      },
    };
    const auditoria = new AuditoriaService(
      repo,
      {
        listGuildReports: () =>
          Promise.resolve([
            { code: 'E2ETerca', title: 'titanbet', revision: 4, startTime: terca },
            { code: 'E2EQuinta', title: 'TitanBet quinta', revision: 2, startTime: quinta },
          ]),
        // O Auditar lê e congela cada report (D-76).
        getTitanBetReport: (code: string) => Promise.resolve(reports[code]!),
      },
      depoisDaQuinta,
    );
    const { auditId } = await auditoria.auditar(rodada.id, OFFICER);

    // 5. Calcular, sobre os snapshots do Auditar — sem WCL (D-76).
    await new CalculoService(repo, depoisDaQuinta).calcular(auditId);

    // 6. Confirmar e liquidar; pagar a Ana.
    await new SettlementService(repo, depoisDaQuinta).confirmar(auditId, OFFICER);
    const ledger = new LedgerService(repo);
    // Top DPS: V 1.000 → P 900, só a Ana em A → 900. Weekly: V 300 → P 270, o prog morreu → 270.
    expect(await ledger.saldo(slipAna.slipId)).toBe(1170);
    expect(await ledger.saldo(slipBia.slipId)).toBe(0);
    await ledger.pagar(slipAna.slipId, OFFICER);
    expect(await ledger.saldo(slipAna.slipId)).toBe(0);

    // O dinheiro fecha (§16.6): depósitos = prêmios + receita da guilda.
    const ls = await db.goldLedgerEntry.findMany({ where: { roundId: rodada.id } });
    const soma = (...kinds: string[]) =>
      ls.filter((l) => kinds.includes(l.kind)).reduce((s, l) => s + l.amount, 0);
    expect(soma('deposito_validado')).toBe(1300);
    expect(soma('premio', 'restituicao_anulado', 'receita_guilda', 'residuo_guilda')).toBe(1300);

    // 7. Closing Report: o membro pelo personagem de elegibilidade (D-48).
    const closing = new ClosingService(new ClosingRepository(db));
    await closing.publicar(rodada.id, OFFICER);
    const publicado = await closing.ultimo(rodada.id);
    const doc = closingReportSchema.parse(publicado!.conteudo);
    expect(doc.totais).toEqual([{ membro: { name: ana, realm: 'azralon' }, devido: 1170 }]);
    const top = doc.mercados.find((m) => m.marketId === topDps)!;
    expect(top).toMatchObject({
      desfecho: 'vencedores',
      vencedores: [{ name: candA, realm: 'Azralon' }],
      ganhos: [{ membro: { name: ana, realm: 'azralon' }, valor: 900 }],
    });
    expect(doc.mercados.find((m) => m.marketId === weekly)!.bossesVencedores).toEqual(['Prog E2E']);
    expect(JSON.stringify(doc)).not.toContain(contaAna.battletag);
    expect(JSON.stringify(doc)).not.toContain(bia);
  });
});
