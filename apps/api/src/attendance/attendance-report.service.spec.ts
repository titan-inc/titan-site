import type { AttendanceRepository } from './attendance.repository';
import { AttendanceReportService } from './attendance-report.service';

const noite = (over: Record<string, unknown> = {}) => ({
  id: 1,
  date: '2026-07-28',
  title: 'Noite de Teste',
  instance: 'Raid de Teste',
  difficulty: 'Mythic',
  optional: false,
  reportCodes: ['aBcD1234'],
  bossPulls: 21,
  hasSignups: true,
  ...over,
});

const linha = (over: Record<string, unknown> = {}) => ({
  id: 'linha-1',
  character: { name: 'Fulano', realm: 'Azralon' },
  signup: 'Present',
  raided: true,
  firstPull: 1,
  pulls: 21,
  note: null,
  ...over,
});

describe('AttendanceReportService', () => {
  const repo = {
    listNights: jest.fn(),
    listForCharacters: jest.fn(),
    saveNote: jest.fn(),
  };

  let service: AttendanceReportService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.listNights.mockResolvedValue([]);
    repo.listForCharacters.mockResolvedValue([]);
    repo.saveNote.mockResolvedValue(undefined);
    service = new AttendanceReportService(repo as unknown as AttendanceRepository);
  });

  it('deriva o estado com a mesma função do shared', async () => {
    repo.listNights.mockResolvedValue([{ ...noite(), attendance: [linha()] }]);

    const r = await service.getReport();

    expect(r.nights[0]?.entries[0]?.state).toBe('presente');
  });

  it('noite sem lista de signup não vira "sem-confirmar"', async () => {
    // As noites de 2024–2025 vêm sem signup do WoWAudit. Dizer que a pessoa
    // "apareceu sem confirmar" ali inventaria indisciplina.
    repo.listNights.mockResolvedValue([
      { ...noite({ hasSignups: false }), attendance: [linha({ signup: null })] },
    ]);

    const r = await service.getReport();

    expect(r.nights[0]?.entries[0]?.state).toBe('raidou');
  });

  it('busca o histórico pelos ids dos personagens da conta', async () => {
    // Quem resolve nome+realm para identidade agora é a sessão, no login
    // (Regra 4). `getMine` só repassa os ids ao repositório.
    await service.getMine(['char-fulano']);

    expect(repo.listForCharacters).toHaveBeenCalledWith(['char-fulano'], expect.any(Number));
  });

  it('soma os personagens da conta — a pessoa é a soma dos chars dela', async () => {
    await service.getMine(['char-fulano', 'char-beltrano']);

    expect(repo.listForCharacters).toHaveBeenCalledWith(
      ['char-fulano', 'char-beltrano'],
      expect.any(Number),
    );
  });

  it('noite sem dado fica fora da taxa de presença', async () => {
    // Entrar como falta afundaria a taxa de quem estava lá.
    repo.listForCharacters.mockResolvedValue([
      { ...linha({ id: 'a' }), raidNight: noite() },
      { ...linha({ id: 'b', raided: null }), raidNight: noite({ id: 2, bossPulls: null }) },
    ]);

    const r = await service.getMine(['char-fulano']);

    expect(r.nights).toHaveLength(2);
    expect(r.summary).toEqual({ counted: 1, present: 1, missed: 0 });
  });

  it('conta como falta só quem confirmou e não apareceu', async () => {
    repo.listForCharacters.mockResolvedValue([
      { ...linha({ id: 'a', raided: false }), raidNight: noite() },
      { ...linha({ id: 'b', signup: 'Standby', raided: false }), raidNight: noite({ id: 2 }) },
      { ...linha({ id: 'c', signup: 'Unknown', raided: false }), raidNight: noite({ id: 3 }) },
    ]);

    const r = await service.getMine(['char-fulano']);

    // Standby é banco declarado e Unknown é rotação. Nenhum dos dois é falta.
    expect(r.summary).toEqual({ counted: 3, present: 0, missed: 1 });
  });

  it('anotação vazia apaga em vez de gravar string vazia', async () => {
    await service.setNote('linha-1', '   ', 'Alguem#1234');

    expect(repo.saveNote).toHaveBeenCalledWith('linha-1', null, 'Alguem#1234');
  });

  it('anotação com texto guarda quem escreveu', async () => {
    await service.setNote('linha-1', '  foi pro banco  ', 'Alguem#1234');

    expect(repo.saveNote).toHaveBeenCalledWith('linha-1', 'foi pro banco', 'Alguem#1234');
  });

  it('conta sem personagem no roster não recebe histórico de ninguém', async () => {
    const r = await service.getMine([]);

    expect(r.nights).toEqual([]);
    expect(r.summary).toEqual({ counted: 0, present: 0, missed: 0 });
  });
});
