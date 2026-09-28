import type { AttendanceRepository } from './attendance.repository';
import { AttendanceReportService } from './attendance-report.service';

// O corte de "raid que ainda não aconteceu" é uma data no fuso da guilda.
// Fixar aqui evita que um .env local mude o resultado do teste.
process.env.GUILD_TIMEZONE = 'America/Sao_Paulo';

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
  signupDeclared: 'Present',
  raided: true,
  firstPull: 1,
  pulls: 21,
  note: null,
  ...over,
});

describe('AttendanceReportService', () => {
  const repo = {
    listNights: jest.fn(),
    saveNote: jest.fn(),
  };

  let service: AttendanceReportService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.listNights.mockResolvedValue([]);
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

  it('não pede ao banco raid que ainda não aconteceu', async () => {
    // O job grava as noites futuras — é o que torna o congelamento de
    // signupDeclared repetível. Elas não são presença: entrariam no topo da
    // lista como noites vazias e empurrariam as reais para fora do limite.
    await service.getReport();

    const [, ate] = repo.listNights.mock.calls[0] as [number, string];
    const hoje = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    expect(ate).toBe(hoje);
  });

  it('anotação vazia apaga em vez de gravar string vazia', async () => {
    await service.setNote('linha-1', '   ', 'Alguem#1234');

    expect(repo.saveNote).toHaveBeenCalledWith('linha-1', null, 'Alguem#1234');
  });

  it('anotação com texto guarda quem escreveu', async () => {
    await service.setNote('linha-1', '  foi pro banco  ', 'Alguem#1234');

    expect(repo.saveNote).toHaveBeenCalledWith('linha-1', 'foi pro banco', 'Alguem#1234');
  });
});
