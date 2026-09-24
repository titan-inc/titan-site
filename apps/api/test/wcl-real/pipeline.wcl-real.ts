import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { closingReportSchema } from '@titan/shared';
import { BlizzardService } from '../../src/blizzard/blizzard.service';
import { CharactersRepository } from '../../src/characters/characters.repository';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ApostasService } from '../../src/titan-bet/apostas.service';
import { AuditoriaRecusada, AuditoriaService } from '../../src/titan-bet/auditoria.service';
import { CalculoService } from '../../src/titan-bet/calculo.service';
import { candidatosDoMercado } from '../../src/titan-bet/candidatos';
import { ClosingRepository } from '../../src/titan-bet/closing.repository';
import { ClosingService } from '../../src/titan-bet/closing.service';
import { DepositoService } from '../../src/titan-bet/deposito.service';
import { ElegibilidadeService } from '../../src/titan-bet/elegibilidade.service';
import { PreparacaoService } from '../../src/titan-bet/preparacao.service';
import { ReadyService } from '../../src/titan-bet/ready.service';
import { LedgerService, SettlementService } from '../../src/titan-bet/settlement.service';
import { TitanBetRepository } from '../../src/titan-bet/titan-bet.repository';
import { WarcraftLogsService } from '../../src/warcraftlogs/warcraftlogs.service';
import { WowAuditService } from '../../src/wowaudit/wowaudit.service';
import { esperarPassar } from '../db/titan-bet/ciclo';
import { depositante, Fabrica } from '../db/titan-bet/fabrica';

/**
 * Validação do pipeline do Titan Bet com o **Warcraft Logs real**
 * (titan-bet-test-design.md §40). Só roda à mão, com a config própria
 * (`test/wcl-real/jest-wcl-real.json`), contra o `titan_test`. O WCL é só lido.
 *
 * **A** — a fonte real entra pela injeção: a auditoria é gravada direto pelo
 * repositório (`gravarAuditoria`), abaixo da descoberta. Isso ignora, só aqui,
 * o prefixo `titanbet*`, a janela da rodada e a associação da sessão. Do cálculo
 * em diante tudo é o código de produção, com Blizzard, WoWAudit e WCL reais.
 *
 * **B** — os mesmos reports pelo Auditar normal: nenhum chega ao motor.
 *
 * Nenhum código de produção sabe que isto existe.
 */

// Amostra real: a semana do reset de 15/09/2026, dois loggers por noite.
const TERCA = ['pbjFHmdvA4hGa7yX', 'hLnPYc7zfRTAgB3C'];
const QUINTA = ['qXpcnzbxAr6dYfPL', '4ncyJGqa6A9htrCd'];
const CUTOFF_REAL = new Date('2026-09-15T15:00:00Z');

// The Venomous Abyss (WCL zone 53).
const NEKZALI = 3470; // farm: morreu na terça
const VASHNIK = 3455; // farm: nem pullado na semana
const EXPLORERS = 3497; // progressão: wipes na terça, kill na quinta
const SENTINELS = 3445; // progressão: 13 wipes na quinta

const OFFICER = { userId: 'officer-wcl-real', battletag: 'Officer#0001' };

describe('Titan Bet — pipeline com o WCL real (§40)', () => {
  let db: PrismaService;
  let repo: TitanBetRepository;
  let f: Fabrica;
  const wcl = new WarcraftLogsService();
  const evidencia: Record<string, unknown> = {};

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    repo = new TitanBetRepository(db);
    f = new Fabrica(db);
  });

  afterAll(async () => {
    const saida = process.env.WCL_REAL_SAIDA;
    if (saida) writeFileSync(saida, JSON.stringify(evidencia, null, 2));
    await db.$disconnect();
  });

  it('A — uma fonte real injetada atravessa o motor inteiro', async () => {
    const blizzard = new BlizzardService();
    const wowaudit = new WowAuditService();

    // 1. Rodada com cutoff logo à frente: Ready e apostas pelo caminho normal.
    const rodada = await f.rodada({ cutoffAt: new Date(Date.now() + 150_000) });
    const prep = new PreparacaoService(repo, blizzard, wcl);
    const vista = await prep.salvar(
      rodada.id,
      {
        weekly: true,
        encounters: [
          {
            encounterId: NEKZALI,
            track: 'farm',
            mercados: [
              'top_dps',
              'top_dps_parse',
              'top_hps',
              'top_hps_parse',
              'top_dispels',
              'first_death',
            ],
          },
          { encounterId: VASHNIK, track: 'farm', mercados: ['top_dps'] },
          { encounterId: EXPLORERS, track: 'progressao', mercados: ['first_death'] },
          { encounterId: SENTINELS, track: 'progressao', mercados: ['first_death'] },
        ],
      },
      OFFICER,
    );

    // 2. Ready com as fontes reais: roster da Blizzard e Titan Roster (WoWAudit).
    await new ReadyService(repo, new CharactersRepository(db), blizzard, wowaudit).ready(
      rodada.id,
      OFFICER,
    );
    const candidatos = await db.betRoundCandidate.findMany({ where: { roundId: rodada.id } });
    const bettors = await db.betRoundBettor.findMany({ where: { roundId: rodada.id } });
    const idsCandidatos = new Set(candidatos.map((c) => c.characterId));
    const livres = bettors.filter((b) => !idsCandidatos.has(b.characterId));
    evidencia.snapshot = {
      bettors: bettors.length,
      candidatos: candidatos.length,
      roles: candidatos.reduce<Record<string, number>>(
        (s, c) => ({ ...s, [c.role]: (s[c.role] ?? 0) + 1 }),
        {},
      ),
    };

    // 3. Contas nos personagens do roster que não são candidatos (self-bet no
    //    First Death fica de fora sem truque). Cada conta aposta em cada mercado,
    //    girando pelos candidatos: todo candidato real tem aposta.
    const mercados = [
      ...vista.encounters.flatMap((e) =>
        e.mercados.map((m) => ({ marketId: m.marketId, kind: m.kind, boss: e.encounterId })),
      ),
    ];
    const porMercado = new Map(
      mercados.map((m) => [
        m.marketId,
        candidatosDoMercado(
          m.kind,
          candidatos.map((c) => ({ characterId: c.characterId, role: c.role })),
        ),
      ]),
    );
    const maior = Math.max(...[...porMercado.values()].map((c) => c.length));
    const prog = vista.encounters.filter((e) => e.track === 'progressao');
    const elegibilidade = new ElegibilidadeService(repo);
    const apostas = new ApostasService(repo, elegibilidade, new CharactersRepository(db));
    const deposito = new DepositoService(repo);
    const contas: Array<{ userId: string; slipId: string }> = [];

    for (let i = 0; i < maior; i++) {
      const b = livres[i]!;
      const user = await db.user.create({
        data: { battlenetId: randomUUID(), battletag: `WclReal${i}#1`, membership: 'member' },
      });
      await db.guildCharacter.create({
        data: { userId: user.id, characterId: b.characterId, rank: b.rank },
      });
      const conta = { userId: user.id, battletag: user.battletag };
      const stake = (k: number) => 200 + ((i * 97 + k * 131) % 801);
      const { slipId } = await apostas.salvar(rodada.id, conta, {
        apostas: [
          ...mercados
            .filter((m) => (porMercado.get(m.marketId) ?? []).length > 0)
            .map((m, k) => {
              const cs = porMercado.get(m.marketId)!;
              return {
                marketId: m.marketId,
                stake: stake(k),
                targetCharacterId: cs[i % cs.length]!.characterId,
              };
            }),
          {
            marketId: vista.weekly!.marketId,
            stake: stake(99),
            encounterId: prog[i % prog.length]!.roundEncounterId,
          },
        ],
      });
      const pj = await db.character.findUniqueOrThrow({ where: { id: b.characterId } });
      await apostas.submeter(rodada.id, conta, depositante(pj));
      await deposito.confirmar(slipId, OFFICER);
      contas.push({ userId: user.id, slipId });
    }
    evidencia.apostas = { contas: contas.length, mercados: mercados.length + 1 };

    // 4. Cutoff pelo relógio do banco.
    await esperarPassar(db, rodada.cutoffAt);

    // 5. A INJEÇÃO — só neste harness: fontes reais que o Auditar normal nunca
    //    escolheria (sem `titanbet*`, fora da janela desta rodada), gravadas
    //    pelo mesmo repositório que o Auditar usa.
    const lidos = await wcl.listGuildReports(
      new Date('2026-09-15T00:00:00Z'),
      new Date('2026-09-19T00:00:00Z'),
    );
    const referencia = (code: string) => {
      const r = lidos.find((x) => x.code === code)!;
      return { code: r.code, title: r.title, revision: r.revision, startTime: r.startTime };
    };
    const { auditId } = await repo.gravarAuditoria({
      roundId: rodada.id,
      officer: OFFICER,
      status: 'pronta',
      fontes: [
        { session: 'terca', resolution: 'automatica', reports: TERCA.map(referencia) },
        { session: 'quinta', resolution: 'automatica', reports: QUINTA.map(referencia) },
      ],
    });
    evidencia.injecao = {
      violacoes: lidos
        .filter((r) => [...TERCA, ...QUINTA].includes(r.code))
        .map((r) => ({
          code: r.code,
          prefixoTitanbet: /^titanbet/i.test(r.title),
          dentroDaJanelaDaRodada: r.startTime >= rodada.cutoffAt.getTime(),
        })),
    };

    // 6. Do cálculo em diante, só código de produção, com o WCL real.
    const calculo = new CalculoService(repo, wcl);
    await calculo.calcular(auditId);
    const resultados = await calculo.resultados(auditId);
    if (!resultados) throw new Error('a auditoria calculada não devolveu resultados');
    evidencia.resultados = resultados;

    // 7. Settlement, ledger e Closing Report.
    await new SettlementService(repo).confirmar(auditId, OFFICER);
    const ls = await db.goldLedgerEntry.findMany({ where: { roundId: rodada.id } });
    const soma = (...kinds: string[]) =>
      ls.filter((l) => kinds.includes(l.kind)).reduce((s, l) => s + l.amount, 0);
    const depositos = soma('deposito_validado');
    const saidas = soma('premio', 'restituicao_anulado', 'receita_guilda', 'residuo_guilda');
    evidencia.ledger = {
      depositos,
      premios: soma('premio'),
      restituicoes: soma('restituicao_anulado'),
      receita: soma('receita_guilda'),
      residuo: soma('residuo_guilda'),
    };
    // O dinheiro fecha (§16.6).
    expect(saidas).toBe(depositos);

    const ledger = new LedgerService(repo);
    const saldos = await ledger.saldos(rodada.id);
    const closing = new ClosingService(new ClosingRepository(db));
    await closing.publicar(rodada.id, OFFICER);
    const doc = closingReportSchema.parse((await closing.ultimo(rodada.id))!.conteudo);
    evidencia.closing = {
      mercados: doc.mercados.map((m) => ({
        kind: m.kind,
        boss: m.encounterName,
        desfecho: m.desfecho,
        motivo: m.motivo,
        vencedores: m.vencedores.length,
        bossesVencedores: m.bossesVencedores,
        ganhos: m.ganhos.length,
      })),
      totais: doc.totais.length,
      guildBank: doc.guildBank,
    };
    // O Closing é o ledger: o total devido publicado é a soma dos saldos.
    expect(doc.totais.reduce((s, t) => s + t.devido, 0)).toBe(
      saldos.saldos.reduce((s, x) => s + x.devido, 0),
    );

    // 8. Conferência independente contra o WCL: vencedor pelo `rankings.amount`
    //    (outro campo da API), não pela tabela que o cálculo usa.
    const doMercado = (boss: number, kind: string) =>
      resultados.mercados.find(
        (m) =>
          m.kind === kind &&
          vista.encounters
            .find((e) => e.encounterId === boss)
            ?.mercados.some((x) => x.marketId === m.marketId),
      )!;
    const leituras = await Promise.all(
      [...TERCA, ...QUINTA].map((c) =>
        wcl.getTitanBetReport(c, [NEKZALI, VASHNIK, EXPLORERS, SENTINELS]),
      ),
    );
    const killsNek = leituras.flatMap((l) =>
      l.fights
        .filter((x) => x.encounterID === NEKZALI && x.kill)
        .map((x) => ({ code: l.code, inicio: l.startTime + x.startTime, leitura: l.kills[x.id]! })),
    );
    killsNek.sort((a, b) => a.inicio - b.inicio);
    const primeira = killsNek[0]!;
    const nomes = new Map(candidatos.map((c) => [c.characterId, c.name]));
    const melhorPorRanking = (lista: Array<{ name: string; amount: number }>, papel: string[]) => {
      const cands = new Set(candidatos.filter((c) => papel.includes(c.role)).map((c) => c.name));
      const deles = lista.filter((x) => cands.has(x.name));
      const max = Math.max(...deles.map((x) => x.amount));
      return deles
        .filter((x) => x.amount === max)
        .map((x) => x.name)
        .sort();
    };
    const vencedores = (m: { vencedores: Array<{ characterId: string }> }) =>
      m.vencedores.map((v) => nomes.get(v.characterId)!).sort();
    evidencia.conferencia = {
      killsDeNekzaliNasFontes: killsNek.map((k) => ({
        code: k.code,
        inicio: new Date(k.inicio).toISOString(),
      })),
      topDps: {
        motor: vencedores(doMercado(NEKZALI, 'top_dps')),
        rankingAmount: melhorPorRanking(primeira.leitura.rankingsDps, ['Melee', 'Ranged']),
      },
      topHps: {
        motor: vencedores(doMercado(NEKZALI, 'top_hps')),
        rankingAmount: melhorPorRanking(primeira.leitura.rankingsHps, ['Heal']),
      },
    };
    expect(vencedores(doMercado(NEKZALI, 'top_dps'))).toEqual(
      melhorPorRanking(primeira.leitura.rankingsDps, ['Melee', 'Ranged']),
    );
    expect(vencedores(doMercado(NEKZALI, 'top_hps'))).toEqual(
      melhorPorRanking(primeira.leitura.rankingsHps, ['Heal']),
    );

    // Parse %: o maior `rankPercent` entre os candidatos da role.
    const melhorParse = (lista: Array<{ name: string; rankPercent: number }>, papel: string[]) => {
      const cands = new Set(candidatos.filter((c) => papel.includes(c.role)).map((c) => c.name));
      const deles = lista.filter((x) => cands.has(x.name));
      const max = Math.max(...deles.map((x) => x.rankPercent));
      return deles
        .filter((x) => x.rankPercent === max)
        .map((x) => x.name)
        .sort();
    };
    expect(vencedores(doMercado(NEKZALI, 'top_dps_parse'))).toEqual(
      melhorParse(primeira.leitura.rankingsDps, ['Melee', 'Ranged']),
    );
    expect(vencedores(doMercado(NEKZALI, 'top_hps_parse'))).toEqual(
      melhorParse(primeira.leitura.rankingsHps, ['Heal']),
    );
    // First Death de farm: a primeira morte bruta da kill usada, entre candidatos.
    const leituraDaKill = leituras.find((l) => l.code === primeira.code)!;
    const fightDaKill = leituraDaKill.fights.find(
      (x) =>
        x.encounterID === NEKZALI &&
        x.kill &&
        leituraDaKill.startTime + x.startTime === primeira.inicio,
    )!;
    const atores = new Map(leituraDaKill.actors.map((a) => [a.id, a.name]));
    const nomesCandidatos = new Set(candidatos.map((c) => c.name));
    const mortes = leituraDaKill.deaths
      .filter(
        (m) => m.fight === fightDaKill.id && nomesCandidatos.has(atores.get(m.targetID) ?? ''),
      )
      .sort((x, y) => x.timestamp - y.timestamp);
    const primeiraMorte = mortes
      .filter((m) => m.timestamp === mortes[0]!.timestamp)
      .map((m) => atores.get(m.targetID)!)
      .sort();
    expect(vencedores(doMercado(NEKZALI, 'first_death'))).toEqual(primeiraMorte);
    (evidencia.conferencia as Record<string, unknown>).parseEFirstDeath = {
      dpsParse: vencedores(doMercado(NEKZALI, 'top_dps_parse')),
      hpsParse: vencedores(doMercado(NEKZALI, 'top_hps_parse')),
      firstDeathFarm: {
        motor: vencedores(doMercado(NEKZALI, 'first_death')),
        mortesBrutas: primeiraMorte,
      },
    };

    // A mesma kill nos dois logs da terça conta uma vez, e a primeira cópia fica
    // (D-62, D-63): o pull usado pelo motor é o de início mais cedo.
    expect(killsNek.length).toBeGreaterThanOrEqual(2);
    const pullDoTopDps = (
      doMercado(NEKZALI, 'top_dps').evidencia.resultado as { pull: { startTime: number } }
    ).pull;
    expect(pullDoTopDps.startTime).toBe(primeira.inicio);

    // Cada try conta uma vez na timeline: as tries do First Death de progressão
    // são as de UM log de cada noite, não a soma dos dois.
    const pullsDe = (code: string, boss: number) =>
      leituras.find((l) => l.code === code)!.fights.filter((x) => x.encounterID === boss).length;
    const triesDe = (boss: number) =>
      (doMercado(boss, 'first_death').evidencia.resultado as { tries: unknown[] }).tries.length;
    const dedup = {
      explorers: {
        motor: triesDe(EXPLORERS),
        umLogPorNoite: pullsDe(TERCA[0]!, EXPLORERS) + pullsDe(QUINTA[0]!, EXPLORERS),
        somaDosLogs: [...TERCA, ...QUINTA].reduce((s, c) => s + pullsDe(c, EXPLORERS), 0),
      },
      sentinels: {
        motor: triesDe(SENTINELS),
        umLogPorNoite: pullsDe(TERCA[0]!, SENTINELS) + pullsDe(QUINTA[0]!, SENTINELS),
        somaDosLogs: [...TERCA, ...QUINTA].reduce((s, c) => s + pullsDe(c, SENTINELS), 0),
      },
    };
    evidencia.deduplicacao = dedup;
    expect(dedup.explorers.motor).toBe(dedup.explorers.umLogPorNoite);
    expect(dedup.sentinels.motor).toBe(dedup.sentinels.umLogPorNoite);
    expect(dedup.explorers.somaDosLogs).toBe(2 * dedup.explorers.umLogPorNoite);
    // Weekly por boss: The Lost Explorers morreu na quinta; Entombed Sentinels não.
    const weekly = resultados.mercados.find((m) => m.kind === 'weekly_progression')!;
    const explorers = vista.encounters.find((e) => e.encounterId === EXPLORERS)!;
    expect(weekly.bossesVencedores).toEqual([explorers.roundEncounterId]);
    // Vashnik nem foi pullado: sem vencedor, o P redistribuído (D-61).
    expect(doMercado(VASHNIK, 'top_dps')).toMatchObject({ outcome: 'sem_vencedor' });
  });

  it('B — os mesmos reports, pelo Auditar normal, não chegam ao motor', async () => {
    // A rodada da semana real deles: cutoff 15/09 12:00 BRT, Ready antes.
    const rodada = await f.rodada({
      opensAt: new Date('2026-09-11T03:00:00Z'),
      cutoffAt: CUTOFF_REAL,
    });
    await f.encounter(rodada.id, { encounterId: NEKZALI, track: 'farm' });
    // Ready antes do cutoff — o banco recusa o contrário (`BetRound_ready_antes_do_cutoff`).
    await db.betRound.update({
      where: { id: rodada.id },
      data: {
        readyAt: new Date('2026-09-12T12:00:00Z'),
        readyByUserId: OFFICER.userId,
        readyByBattletag: OFFICER.battletag,
      },
    });

    const auditoria = new AuditoriaService(repo, wcl);
    const { auditId } = await auditoria.auditar(rodada.id, OFFICER);
    const fontes = await db.betAuditSource.findMany({
      where: { auditId },
      include: { reports: true },
    });
    const audit = await db.betAudit.findUniqueOrThrow({ where: { id: auditId } });
    evidencia.caminhoNormal = {
      status: audit.status,
      fontes: fontes.map((x) => ({
        session: x.session,
        resolution: x.resolution,
        reports: x.reports.map((r) => r.reportCode),
      })),
    };

    // Estão na janela e nos dias certos, mas não são `titanbet*`: ausente.
    expect(fontes.map((x) => x.resolution).sort()).toEqual(['ausente', 'ausente']);
    expect(fontes.flatMap((x) => x.reports)).toEqual([]);
    expect(audit.status).toBe('aguardando_revisao');
    // Sem fonte e sem "sem raid" declarado, o cálculo é recusado.
    await expect(new CalculoService(repo, wcl).calcular(auditId)).rejects.toBeInstanceOf(
      AuditoriaRecusada,
    );
  });
});
