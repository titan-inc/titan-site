import type { CharactersRepository, PersonagemDaFonte } from '../characters/characters.repository';
import { chaveDe, indice } from '../characters/characters.repository';
import type { TeamCharacter, WowAuditService } from '../wowaudit/wowaudit.service';
import type { RotationRepository } from './rotation.repository';
import { RotationService } from './rotation.service';

process.env.GUILD_TIMEZONE = 'America/Sao_Paulo';

/** Id determinístico a partir da chave, só para o teste comparar. */
const idDe = (p: { name: string; realm: string }) => `char:${indice(chaveDe(p))}`;

const pessoa = (name: string, role: string): TeamCharacter => ({
  name,
  realm: 'Azralon',
  wowClass: 'WARLOCK',
  role,
});

/** Time pequeno, com um de cada role, para as asserções caberem na cabeça. */
const TIME = [
  pessoa('Tanky', 'Tank'),
  pessoa('Tanko', 'Tank'),
  pessoa('Curador', 'Heal'),
  pessoa('Espadas', 'Melee'),
  pessoa('Arqueiro', 'Ranged'),
  pessoa('Kusiak', 'Ranged'),
];

describe('RotationService', () => {
  const wowaudit = {
    getTeamCharacters: jest.fn(),
    getTeamCharactersSnapshot: jest.fn(),
  };

  const repo = {
    listRoleLocks: jest.fn(),
    setRoleLocks: jest.fn(),
    listPlayerLocks: jest.fn(),
    createPlayerLock: jest.fn(),
    deletePlayerLock: jest.fn(),
    findPlan: jest.fn(),
    savePlan: jest.fn(),
    listPlanEntries: jest.fn(),
    listStandbys: jest.fn(),
    listPresenca: jest.fn(),
  };

  const characters = {
    resolverVarios: jest.fn((ps: PersonagemDaFonte[]) =>
      Promise.resolve(new Map(ps.map((p) => [indice(chaveDe(p)), idDe(p)]))),
    ),
  };

  let service: RotationService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(Date.parse('2026-09-30T15:00:00Z'));

    wowaudit.getTeamCharacters.mockResolvedValue(TIME);
    wowaudit.getTeamCharactersSnapshot.mockResolvedValue({
      characters: TIME,
      fetchedAt: Date.now(),
      stale: false,
    });

    repo.listRoleLocks.mockResolvedValue([]);
    repo.listPlayerLocks.mockResolvedValue([]);
    repo.findPlan.mockResolvedValue(null);
    repo.listPlanEntries.mockResolvedValue([]);
    repo.listStandbys.mockResolvedValue([]);
    repo.listPresenca.mockResolvedValue([]);

    service = new RotationService(
      wowaudit as unknown as WowAuditService,
      repo as unknown as RotationRepository,
      characters as unknown as CharactersRepository,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a semana é a segunda-feira no fuso da guilda', async () => {
    // 30/09/2026 é uma quarta; a semana dela começa na segunda, dia 28.
    const v = await service.getView();

    expect(v.weekStart).toBe('2026-09-28');
  });

  it('role travada não entra na sugestão', async () => {
    repo.listRoleLocks.mockResolvedValue([{ role: 'Tank', lockedBy: 'x', lockedAt: new Date() }]);

    const v = await service.getView();

    expect(v.suggestion.some((s) => s.role === 'Tank')).toBe(false);
    // Continuam no pool: a tela mostra quem está fora e por quê.
    expect(v.pool.filter((p) => p.role === 'Tank')).toHaveLength(2);
    expect(v.pool.find((p) => p.name === 'Tanky')?.lock).toMatchObject({ kind: 'role' });
  });

  it('jogador travado não entra na sugestão e carrega o motivo', async () => {
    repo.listPlayerLocks.mockResolvedValue([
      {
        id: 'trava-1',
        characterId: idDe({ name: 'Kusiak', realm: 'Azralon' }),
        reason: 'único warlock',
        lockedBy: 'x',
        lockedAt: new Date('2026-09-07T12:00:00Z'),
        character: { name: 'Kusiak', realm: 'Azralon' },
      },
    ]);

    const v = await service.getView();

    expect(v.suggestion.some((s) => s.name === 'Kusiak')).toBe(false);
    expect(v.pool.find((p) => p.name === 'Kusiak')?.lock).toMatchObject({
      kind: 'player',
      reason: 'único warlock',
      // Semana de 07/09 até a de 28/09: três semanas travado. É esse número que
      // faz alguém revisar um motivo que já deixou de valer.
      weeks: 3,
    });
  });

  it('quem está há mais tempo sem banco vem primeiro, e quem nunca foi na frente', async () => {
    repo.listStandbys.mockResolvedValue([
      // Sentou na semana de 21/09 — a mais recente, então vai por último.
      {
        characterId: idDe({ name: 'Espadas', realm: 'Azralon' }),
        raidNight: { date: '2026-09-22' },
      },
      {
        characterId: idDe({ name: 'Arqueiro', realm: 'Azralon' }),
        raidNight: { date: '2026-09-08' },
      },
    ]);

    const v = await service.getView();
    const nomes = v.suggestion.map((s) => s.name);

    // Dentro da mesma role (os dois são Ranged), quem nunca foi banco passa na
    // frente de quem sentou há 3 semanas — e a vaga da role é uma só.
    expect(nomes).toContain('Kusiak');
    expect(nomes).not.toContain('Arqueiro');

    expect(v.pool.find((p) => p.name === 'Espadas')?.weeksSinceBench).toBe(1);
    expect(v.pool.find((p) => p.name === 'Arqueiro')?.weeksSinceBench).toBe(3);
    expect(v.pool.find((p) => p.name === 'Kusiak')?.weeksSinceBench).toBeNull();
  });

  it('espalha o banco pelos roles na proporção do time', async () => {
    // O bug que a tela real expôs: com quase todo mundo empatado em "ainda
    // não foi banco", o desempate por nome sentava 3 dos 6 healers e quebrava
    // a raid.
    // Com 2 tanks, 6 healers, 10 melee e 8 ranged, 5 vagas têm que virar
    // 2 melee, 2 ranged e 1 healer.
    const grande = [
      pessoa('Tank1', 'Tank'),
      pessoa('Tank2', 'Tank'),
      ...Array.from({ length: 6 }, (_, i) => pessoa(`Heal${i}`, 'Heal')),
      ...Array.from({ length: 10 }, (_, i) => pessoa(`Melee${i}`, 'Melee')),
      ...Array.from({ length: 8 }, (_, i) => pessoa(`Range${i}`, 'Ranged')),
    ];
    wowaudit.getTeamCharactersSnapshot.mockResolvedValue({
      characters: grande,
      fetchedAt: Date.now(),
      stale: false,
    });

    const v = await service.getView();
    const porRole = v.suggestion.reduce<Record<string, number>>((acc, s) => {
      acc[s.role] = (acc[s.role] ?? 0) + 1;
      return acc;
    }, {});

    expect(v.suggestion).toHaveLength(5);
    expect(porRole).toEqual({ Melee: 2, Ranged: 2, Heal: 1 });
  });

  it('não distribui vaga para role travada', async () => {
    repo.listRoleLocks.mockResolvedValue([
      { role: 'Melee', lockedBy: 'x', lockedAt: new Date() },
      { role: 'Ranged', lockedBy: 'x', lockedAt: new Date() },
    ]);

    const v = await service.getView();

    // Sobram 2 tanks e 1 healer: a sugestão não pode inventar gente nem
    // estourar as filas que restaram.
    expect(v.suggestion).toHaveLength(3);
    expect(v.suggestion.every((s) => s.role === 'Tank' || s.role === 'Heal')).toBe(true);
  });

  describe('recalcular com outro número de vagas', () => {
    it('o parâmetro sobrepõe o plano salvo, sem gravar nada', async () => {
      repo.findPlan.mockResolvedValue({
        seats: 2,
        entries: [],
        savedBy: 'x',
        savedAt: new Date(),
        weekStart: '2026-09-28',
      });

      const v = await service.getView(undefined, 4);

      expect(v.seats).toBe(4);
      expect(v.suggestion).toHaveLength(4);
      // O plano salvo continua com o número dele: recalcular é rascunho.
      expect(v.saved?.seats).toBe(2);
      expect(repo.savePlan).not.toHaveBeenCalled();
    });

    it('zero vagas é um pedido válido, não "usa o default"', async () => {
      const v = await service.getView(undefined, 0);

      expect(v.seats).toBe(0);
      expect(v.suggestion).toEqual([]);
    });

    it('parâmetro lixo cai no default em vez de zerar a sugestão', async () => {
      // `Number('abc')` é NaN, e toda comparação com NaN é falsa — sem a
      // checagem explícita isto viraria zero vaga sem erro nenhum.
      const v = await service.getView(undefined, Number('abc'));

      expect(v.seats).toBe(5);
      expect(v.suggestion).toHaveLength(5);
    });
  });

  describe('fixar alguém no banco', () => {
    /** Time grande, para a proporção ter o que mostrar. */
    const grande = [
      pessoa('Tank1', 'Tank'),
      pessoa('Tank2', 'Tank'),
      ...Array.from({ length: 6 }, (_, i) => pessoa(`Heal${i}`, 'Heal')),
      ...Array.from({ length: 10 }, (_, i) => pessoa(`Melee${i}`, 'Melee')),
      ...Array.from({ length: 8 }, (_, i) => pessoa(`Range${i}`, 'Ranged')),
    ];

    const contarRoles = (v: { suggestion: { role: string }[] }) =>
      v.suggestion.reduce<Record<string, number>>((acc, s) => {
        acc[s.role] = (acc[s.role] ?? 0) + 1;
        return acc;
      }, {});

    beforeEach(() => {
      // Os dois: `getView` usa o snapshot, `savePlan` usa a lista direta.
      wowaudit.getTeamCharacters.mockResolvedValue(grande);
      wowaudit.getTeamCharactersSnapshot.mockResolvedValue({
        characters: grande,
        fetchedAt: Date.now(),
        stale: false,
      });
    });

    it('o fixado sobrevive ao recálculo e sai marcado', async () => {
      // O caso do RL: numa luta em que a classe rende mal, sentar aquela pessoa
      // mesmo que a conta não a escolhesse.
      const forcado = idDe({ name: 'Melee9', realm: 'Azralon' });

      const semFixar = await service.getView();
      expect(semFixar.suggestion.map((x) => x.characterId)).not.toContain(forcado);

      const v = await service.getView(undefined, 5, [forcado]);

      expect(v.suggestion.map((x) => x.characterId)).toContain(forcado);
      expect(v.suggestion.find((x) => x.characterId === forcado)?.pinned).toBe(true);
    });

    it('o fixado consome vaga da role dele, então o banco continua proporcional', async () => {
      // Sem isso, fixar um melee daria um melee a mais no banco e
      // desequilibraria justamente o que o D'Hondt existe para equilibrar.
      const forcado = idDe({ name: 'Melee9', realm: 'Azralon' });

      const v = await service.getView(undefined, 5, [forcado]);

      expect(v.suggestion).toHaveLength(5);
      expect(contarRoles(v)).toEqual({ Melee: 2, Ranged: 2, Heal: 1 });
    });

    it('fixar mais gente que as vagas mantém todos — a decisão é do RL', async () => {
      const tres = ['Melee9', 'Melee8', 'Melee7'].map((n) => idDe({ name: n, realm: 'Azralon' }));

      const v = await service.getView(undefined, 2, tres);

      expect(v.suggestion).toHaveLength(3);
      expect(v.suggestion.every((x) => x.pinned)).toBe(true);
    });

    it('fixado que virou travado sai do banco', async () => {
      repo.listRoleLocks.mockResolvedValue([
        { role: 'Melee', lockedBy: 'x', lockedAt: new Date() },
      ]);
      const forcado = idDe({ name: 'Melee9', realm: 'Azralon' });

      const v = await service.getView(undefined, 5, [forcado]);

      // Quem está fora da rotação não pode estar no banco, mesmo tendo sido
      // fixado antes de a trava existir.
      expect(v.suggestion.map((x) => x.characterId)).not.toContain(forcado);
    });

    it('sem o parâmetro, valem as fixações do plano salvo', async () => {
      // Recarregar a tela não pode perder uma fixação já decidida.
      const forcado = idDe({ name: 'Melee9', realm: 'Azralon' });
      repo.findPlan.mockResolvedValue({
        seats: 5,
        entries: [{ characterId: forcado, pinned: true }],
        savedBy: 'x',
        savedAt: new Date(),
        weekStart: '2026-09-28',
      });

      const v = await service.getView();

      expect(v.suggestion.find((x) => x.characterId === forcado)?.pinned).toBe(true);
      expect(v.saved?.pinned).toEqual([forcado]);
    });

    it('lista de fixos vazia é diferente de ausente — solta todo mundo', async () => {
      const forcado = idDe({ name: 'Melee9', realm: 'Azralon' });
      repo.findPlan.mockResolvedValue({
        seats: 5,
        entries: [{ characterId: forcado, pinned: true }],
        savedBy: 'x',
        savedAt: new Date(),
        weekStart: '2026-09-28',
      });

      const v = await service.getView(undefined, 5, []);

      expect(v.suggestion.every((x) => !x.pinned)).toBe(true);
    });

    it('recusa fixar quem não está no banco', async () => {
      const dentro = idDe({ name: 'Melee9', realm: 'Azralon' });
      const fora = idDe({ name: 'Melee8', realm: 'Azralon' });

      await expect(
        service.savePlan(
          { weekStart: '2026-09-28', seats: 5, characterIds: [dentro], pinned: [fora] },
          'Eu#1',
        ),
      ).rejects.toThrow(/fixar quem está no banco/);

      expect(repo.savePlan).not.toHaveBeenCalled();
    });

    it('grava as fixações junto com o plano', async () => {
      const forcado = idDe({ name: 'Melee9', realm: 'Azralon' });

      await service.savePlan(
        { weekStart: '2026-09-28', seats: 5, characterIds: [forcado], pinned: [forcado] },
        'Eu#1',
      );

      expect(repo.savePlan).toHaveBeenCalledWith('2026-09-28', 5, [forcado], [forcado], 'Eu#1');
    });
  });

  it('respeita quantos sentar', async () => {
    repo.findPlan.mockResolvedValue({
      seats: 2,
      entries: [],
      savedBy: 'x',
      savedAt: new Date(),
      weekStart: '2026-09-28',
    });

    const v = await service.getView();

    expect(v.seats).toBe(2);
    expect(v.suggestion).toHaveLength(2);
  });

  describe('banco planejado só conta se a pessoa apareceu', () => {
    const espadas = idDe({ name: 'Espadas', realm: 'Azralon' });

    beforeEach(() => {
      repo.listPlanEntries.mockResolvedValue([
        { characterId: espadas, plan: { weekStart: '2026-09-21' } },
      ]);
    });

    it('sentou e apareceu conta como descanso cumprido', async () => {
      repo.listPresenca.mockResolvedValue([
        { characterId: espadas, date: '2026-09-22', signup: 'Standby', raided: false },
      ]);

      const v = await service.getView();

      expect(v.pool.find((p) => p.name === 'Espadas')?.weeksSinceBench).toBe(1);
    });

    it('sentou e NÃO apareceu não conta — senão a rotação premiaria quem falta', async () => {
      repo.listPresenca.mockResolvedValue([
        { characterId: espadas, date: '2026-09-22', signup: 'Absent', raided: false },
      ]);

      const v = await service.getView();

      // Null, e não 1: o descanso não foi cumprido, então a pessoa continua na
      // fila em vez de voltar na frente dela.
      expect(v.pool.find((p) => p.name === 'Espadas')?.weeksSinceBench).toBeNull();
    });

    it('semana sem registro de presença conta a favor da pessoa', async () => {
      // Lacuna de coleta não é prova de ausência — a mesma regra do `sem-dado`
      // da presença. Punir aqui seria punir por o job não ter rodado.
      repo.listPresenca.mockResolvedValue([]);

      const v = await service.getView();

      expect(v.pool.find((p) => p.name === 'Espadas')?.weeksSinceBench).toBe(1);
    });
  });

  it('plano desta semana não conta como descanso já cumprido', async () => {
    const espadas = idDe({ name: 'Espadas', realm: 'Azralon' });
    repo.listPlanEntries.mockResolvedValue([
      { characterId: espadas, plan: { weekStart: '2026-09-28' } },
    ]);

    const v = await service.getView();

    // A semana ainda vai acontecer: contar já daria descanso por antecipação.
    expect(v.pool.find((p) => p.name === 'Espadas')?.weeksSinceBench).toBeNull();
  });

  it('avisa quando o time veio de cache velho', async () => {
    wowaudit.getTeamCharactersSnapshot.mockResolvedValue({
      characters: TIME,
      fetchedAt: Date.now(),
      stale: true,
    });

    const v = await service.getView();

    // Decidir banco com time velho é sentar quem já saiu. A tela avisa.
    expect(v.teamStale).toBe(true);
  });

  it('role desconhecida do WoWAudit derruba a pessoa, não a tela', async () => {
    wowaudit.getTeamCharactersSnapshot.mockResolvedValue({
      characters: [...TIME, pessoa('Novidade', 'Support')],
      fetchedAt: Date.now(),
      stale: false,
    });

    const v = await service.getView();

    expect(v.pool.some((p) => p.name === 'Novidade')).toBe(false);
    expect(v.pool).toHaveLength(TIME.length);
  });

  it('recusa travar quem não está no time', async () => {
    await expect(
      service.createPlayerLock({ characterId: 'char:desconhecido', reason: 'sei lá' }, 'Eu#1'),
    ).rejects.toThrow(/não está no time/);

    expect(repo.createPlayerLock).not.toHaveBeenCalled();
  });

  it('recusa plano com gente de fora do time', async () => {
    await expect(
      service.savePlan(
        { weekStart: '2026-09-28', seats: 5, characterIds: ['char:desconhecido'], pinned: [] },
        'Eu#1',
      ),
    ).rejects.toThrow(/não estão no time/);

    expect(repo.savePlan).not.toHaveBeenCalled();
  });

  it('salva o plano na segunda da semana, mesmo recebendo outro dia', async () => {
    await service.savePlan(
      {
        weekStart: '2026-10-01',
        seats: 3,
        characterIds: [idDe({ name: 'Espadas', realm: 'Azralon' })],
        pinned: [],
      },
      'Eu#1',
    );

    expect(repo.savePlan).toHaveBeenCalledWith(
      '2026-09-28',
      3,
      [idDe({ name: 'Espadas', realm: 'Azralon' })],
      [],
      'Eu#1',
    );
  });

  it('aceita plano que contraria a sugestão — quem decide é o oficial', async () => {
    const tanky = idDe({ name: 'Tanky', realm: 'Azralon' });
    repo.listRoleLocks.mockResolvedValue([{ role: 'Tank', lockedBy: 'x', lockedAt: new Date() }]);

    await service.savePlan(
      { weekStart: '2026-09-28', seats: 1, characterIds: [tanky], pinned: [] },
      'Eu#1',
    );

    // Tank está travado e ainda assim o plano passa: recusar a decisão do
    // oficial seria a ferramenta mandando em quem ela deveria ajudar.
    expect(repo.savePlan).toHaveBeenCalledWith('2026-09-28', 1, [tanky], [], 'Eu#1');
  });
});
