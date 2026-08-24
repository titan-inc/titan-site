import {
  chaveDe,
  indice,
  type CharactersRepository,
  type PersonagemDaFonte,
} from '../characters/characters.repository';
import type {
  ReportParticipation,
  WarcraftLogsService,
} from '../warcraftlogs/warcraftlogs.service';
import type { PlannedRaid, WowAuditService } from '../wowaudit/wowaudit.service';
import type { AttendanceInput, AttendanceRepository } from './attendance.repository';
import { AttendanceService } from './attendance.service';

/** Id determinístico a partir da chave, só para o teste comparar. */
const idDoPersonagem = (p: PersonagemDaFonte): string => `char:${indice(chaveDe(p))}`;

process.env.GUILD_NAME = 'Guilda de Teste';
process.env.GUILD_REALM = 'Realm de Teste';
process.env.GUILD_TIMEZONE = 'America/Sao_Paulo';

const raid = (over: Partial<PlannedRaid> = {}): PlannedRaid => ({
  id: 1,
  date: '2026-07-28',
  title: 'Noite de Teste',
  instance: 'Raid de Teste',
  difficulty: 'Mythic',
  optional: false,
  seasonId: 17,
  ...over,
});

const relatorio = (over: Partial<ReportParticipation> = {}): ReportParticipation => ({
  code: 'aBcD1234',
  // 28/07/2026 21:30 BRT — já é dia 29 em UTC, que é o ponto do fuso.
  startedAt: Date.parse('2026-07-29T00:30:00Z'),
  bossPulls: 10,
  players: [],
  ...over,
});

describe('AttendanceService', () => {
  const wowaudit = { getPlannedRaids: jest.fn(), getRaidSignups: jest.fn() };
  const wcl = { getRaidParticipation: jest.fn() };
  const repo = { saveNight: jest.fn() };
  const characters = {
    resolverVarios: jest.fn((personagens: PersonagemDaFonte[]) =>
      Promise.resolve(new Map(personagens.map((p) => [indice(chaveDe(p)), idDoPersonagem(p)]))),
    ),
  };

  let service: AttendanceService;

  /** O que foi mandado gravar — `mock.calls` é `any`. */
  const gravados = (): AttendanceInput[] => {
    const calls = repo.saveNight.mock.calls as unknown as Array<[unknown, AttendanceInput[]]>;
    return calls[0]?.[1] ?? [];
  };
  const noite = () => {
    const calls = repo.saveNight.mock.calls as unknown as Array<
      [{ reportCodes: string[]; bossPulls: number | null; date: string }, unknown]
    >;
    return calls[0]?.[0];
  };
  /**
   * A linha gravada desta pessoa, achada pelo nome que foi mandado resolver.
   *
   * `AttendanceInput` só tem `characterId` — o nome já não viaja com a linha.
   * Por isso o achado passa por quem `resolverVarios` recebeu nesta rodada.
   */
  const de = (nome: string) => {
    const pessoa = (characters.resolverVarios.mock.calls as unknown as Array<[PersonagemDaFonte[]]>)
      .flatMap((args) => args[0])
      .find((p) => p.name === nome);
    if (!pessoa) return undefined;

    return gravados().find((g) => g.characterId === idDoPersonagem(pessoa));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    wowaudit.getPlannedRaids.mockResolvedValue([raid()]);
    wowaudit.getRaidSignups.mockResolvedValue([]);
    wcl.getRaidParticipation.mockResolvedValue([]);
    repo.saveNight.mockImplementation((_n: unknown, e: unknown[]) => Promise.resolve(e.length));

    service = new AttendanceService(
      wowaudit as unknown as WowAuditService,
      wcl as unknown as WarcraftLogsService,
      repo as unknown as AttendanceRepository,
      characters as unknown as CharactersRepository,
    );
  });

  it('casa realm composto entre WoWAudit e Warcraft Logs', async () => {
    // O caso que gerava acusação falsa: o signup diz "Area 52" e o log diz
    // "Area52". Por toSlug() viravam duas pessoas — uma que sumiu e outra que
    // apareceu sem confirmar.
    wowaudit.getRaidSignups.mockResolvedValue([
      {
        name: 'Fulano',
        realm: 'Area 52',
        nameKey: 'fulano',
        realmSlug: 'area-52',
        status: 'Present',
      },
    ]);
    wcl.getRaidParticipation.mockResolvedValue([
      relatorio({ players: [{ name: 'Fulano', realm: 'Area52', firstPull: 1, pulls: 10 }] }),
    ]);

    await service.sync();

    // Uma linha só: com a chave estrita (toSlug), "Area 52" do signup e
    // "Area52" do log virariam duas identidades — a pessoa apareceria como
    // "sumiu" e "apareceu sem confirmar" ao mesmo tempo.
    expect(gravados()).toHaveLength(1);
    expect(de('Fulano')).toMatchObject({ signup: 'Present', raided: true });
  });

  it('log sem pull de boss é SEM DADO, nunca falta coletiva', async () => {
    // Caso real: 21/07/2026 tem um log de 10 minutos, sem zona e sem pull.
    // Contar pela existência do arquivo acusaria as 22 pessoas da noite.
    wowaudit.getRaidSignups.mockResolvedValue([
      {
        name: 'Fulano',
        realm: 'Azralon',
        nameKey: 'fulano',
        realmSlug: 'azralon',
        status: 'Present',
      },
    ]);
    wcl.getRaidParticipation.mockResolvedValue([relatorio({ bossPulls: 0, players: [] })]);

    const r = await service.sync();

    expect(de('Fulano')?.raided).toBeNull();
    expect(noite()?.bossPulls).toBeNull();
    expect(r).toMatchObject({ withLog: 0, withoutLog: 1 });
  });

  it('noite sem log nenhum também é sem dado', async () => {
    wowaudit.getRaidSignups.mockResolvedValue([
      {
        name: 'Fulano',
        realm: 'Azralon',
        nameKey: 'fulano',
        realmSlug: 'azralon',
        status: 'Present',
      },
    ]);

    await service.sync();

    expect(de('Fulano')?.raided).toBeNull();
  });

  it('confirmou e não apareceu vira raided=false quando há evidência', async () => {
    wowaudit.getRaidSignups.mockResolvedValue([
      {
        name: 'Fulano',
        realm: 'Azralon',
        nameKey: 'fulano',
        realmSlug: 'azralon',
        status: 'Present',
      },
      {
        name: 'Beltrano',
        realm: 'Azralon',
        nameKey: 'beltrano',
        realmSlug: 'azralon',
        status: 'Present',
      },
    ]);
    wcl.getRaidParticipation.mockResolvedValue([
      relatorio({ players: [{ name: 'Fulano', realm: 'Azralon', firstPull: 1, pulls: 10 }] }),
    ]);

    await service.sync();

    expect(de('Fulano')?.raided).toBe(true);
    expect(de('Beltrano')?.raided).toBe(false);
  });

  it('quem aparece no log sem ter feito signup entra na noite', async () => {
    wcl.getRaidParticipation.mockResolvedValue([
      relatorio({ players: [{ name: 'Avulso', realm: 'Illidan', firstPull: 3, pulls: 8 }] }),
    ]);

    await service.sync();

    expect(de('Avulso')).toMatchObject({ signup: null, raided: true, firstPull: 3 });
  });

  it('dois logs na mesma noite viram um só, por união', async () => {
    // Acontece de verdade (18/06/2026). Escolher um descartaria presença real.
    wcl.getRaidParticipation.mockResolvedValue([
      relatorio({
        code: 'aaa1',
        bossPulls: 5,
        players: [{ name: 'Fulano', realm: 'Azralon', firstPull: 4, pulls: 5 }],
      }),
      relatorio({
        code: 'bbb2',
        bossPulls: 6,
        players: [{ name: 'Fulano', realm: 'Azralon', firstPull: 2, pulls: 6 }],
      }),
    ]);

    await service.sync();

    expect(de('Fulano')).toMatchObject({ pulls: 11, firstPull: 2 });
    expect(noite()?.reportCodes).toEqual(['aaa1', 'bbb2']);
    expect(noite()?.bossPulls).toBe(11);
  });

  it('data do log é a do fuso da guilda, não a de UTC', async () => {
    // O log começa 00:30 UTC de 29/07, que é 21:30 de 28/07 em BRT. Datando em
    // UTC, a noite de 28 ficaria sem log e todo mundo viraria "Não Raidou".
    wcl.getRaidParticipation.mockResolvedValue([
      relatorio({
        startedAt: Date.parse('2026-07-29T00:30:00Z'),
        players: [{ name: 'Fulano', realm: 'Azralon', firstPull: 1, pulls: 10 }],
      }),
    ]);

    await service.sync();

    expect(noite()?.date).toBe('2026-07-28');
    expect(de('Fulano')?.raided).toBe(true);
  });

  it('duas raids marcadas no mesmo dia ficam sem log, em vez de chutar', async () => {
    wowaudit.getPlannedRaids.mockResolvedValue([
      raid({ id: 1, date: '2026-07-28' }),
      raid({ id: 2, date: '2026-07-28', optional: true }),
    ]);
    wowaudit.getRaidSignups.mockResolvedValue([
      {
        name: 'Fulano',
        realm: 'Azralon',
        nameKey: 'fulano',
        realmSlug: 'azralon',
        status: 'Present',
      },
    ]);
    wcl.getRaidParticipation.mockResolvedValue([
      relatorio({ players: [{ name: 'Fulano', realm: 'Azralon', firstPull: 1, pulls: 10 }] }),
    ]);

    const r = await service.sync();

    expect(r.ambiguous).toBe(2);
    expect(de('Fulano')?.raided).toBeNull();
  });

  it('uma noite que falha não derruba as outras', async () => {
    wowaudit.getPlannedRaids.mockResolvedValue([
      raid({ id: 1, date: '2026-07-21' }),
      raid({ id: 2, date: '2026-07-28' }),
    ]);
    wowaudit.getRaidSignups.mockRejectedValueOnce(new Error('WoWAudit fora do ar'));

    const r = await service.sync();

    expect(r.nights).toBe(2);
    expect(repo.saveNight).toHaveBeenCalledTimes(1);
  });

  it('a rodada agendada não deixa exceção escapar', async () => {
    wowaudit.getPlannedRaids.mockRejectedValue(new Error('WoWAudit fora do ar'));

    await expect(service.syncScheduled()).resolves.toBeUndefined();
  });

  it('grava a flag optional para a raid do core não se misturar com run de alt', async () => {
    wowaudit.getPlannedRaids.mockResolvedValue([raid({ optional: true })]);

    await service.sync();

    expect(noite()).toMatchObject({ optional: true });
  });
});
