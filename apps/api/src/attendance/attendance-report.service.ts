import { Injectable, NotFoundException } from '@nestjs/common';
import {
  isPresent,
  signupStatusSchema,
  toAttendanceState,
  type AttendanceEntry,
  type AttendanceReport,
  type MyAttendance,
  type RaidNightInfo,
  type SignupStatus,
} from '@titan/shared';
import { loadGuildTimezone } from '../config/guild.config';
import { AttendanceRepository } from './attendance.repository';

/** Quantas noites a tela mostra. Duas temporadas de raid cabem folgado. */
const NOITES = 60;

/** Uma linha de presença como sai do banco. */
interface LinhaDoBanco {
  id: string;
  character: { name: string; realm: string };
  signup: string | null;
  signupDeclared: string | null;
  raided: boolean | null;
  firstPull: number | null;
  pulls: number | null;
  note: string | null;
}

/** Uma noite como sai do banco. */
interface NoiteDoBanco {
  id: number;
  date: string;
  title: string;
  instance: string;
  difficulty: string;
  optional: boolean;
  reportCodes: string[];
  bossPulls: number | null;
  hasSignups: boolean;
}

/**
 * Leitura da presença já gravada.
 *
 * Separado do `AttendanceService`, que é o job de ingestão: um grava contra as
 * APIs externas, o outro só lê o banco. Misturar faria a tela depender de o
 * WoWAudit estar de pé.
 */
@Injectable()
export class AttendanceReportService {
  private readonly timezone = loadGuildTimezone();

  constructor(private readonly repo: AttendanceRepository) {}

  /** Todas as noites, com todo mundo. Só oficial — Regra 7. */
  async getReport(): Promise<AttendanceReport> {
    const noites = await this.repo.listNights(NOITES, this.hoje());

    return {
      nights: noites.map((n) => ({
        ...this.info(n),
        entries: n.attendance.map((a) => this.entry(a, n.hasSignups)),
      })),
    };
  }

  /**
   * O histórico da própria pessoa, somando os personagens dela.
   *
   * @param characterIds identidades dos personagens da conta no roster
   */
  async getMine(characterIds: string[]): Promise<MyAttendance> {
    const linhas = await this.repo.listForCharacters(characterIds, NOITES, this.hoje());

    const nights = linhas.map((l) => ({
      ...this.info(l.raidNight),
      entry: this.entry(l, l.raidNight.hasSignups),
    }));

    // "counted" ignora `sem-dado` de propósito: noite sem log não pode afundar
    // a taxa de presença de quem estava lá.
    const contadas = nights.filter((n) => n.entry.state !== 'sem-dado');

    return {
      nights,
      summary: {
        counted: contadas.length,
        present: contadas.filter((n) => isPresent(n.entry.state)).length,
        // `furou` entra junto: é o mesmo fato (confirmou e não veio), só que
        // confirmado pelo RL em vez de inferido. Contar só um dos dois faria a
        // conta encolher conforme o RL for corrigindo as noites.
        missed: contadas.filter((n) => n.entry.state === 'nao-raidou' || n.entry.state === 'furou')
          .length,
      },
    };
  }

  /**
   * Anota o motivo de alguém não ter raidado.
   *
   * É a correção do humano sobre o único quadrante que o log não desambigua —
   * banco decidido na hora e furo são idênticos no log e opostos na prática.
   * Texto vazio apaga a anotação em vez de gravar string vazia.
   */
  async setNote(id: string, note: string, author: string): Promise<void> {
    const limpo = note.trim();

    try {
      await this.repo.saveNote(id, limpo === '' ? null : limpo, author);
    } catch {
      throw new NotFoundException(`Registro de presença ${id} não existe`);
    }
  }

  private info(n: NoiteDoBanco): RaidNightInfo {
    return {
      id: n.id,
      date: n.date,
      title: n.title,
      instance: n.instance,
      difficulty: n.difficulty,
      optional: n.optional,
      reportCodes: n.reportCodes,
      bossPulls: n.bossPulls,
      hasSignups: n.hasSignups,
    };
  }

  private entry(a: LinhaDoBanco, hasSignups: boolean): AttendanceEntry {
    const signup = this.signup(a.signup);
    const signupDeclared = this.signup(a.signupDeclared);

    return {
      id: a.id,
      name: a.character.name,
      realm: a.character.realm,
      signup,
      signupDeclared,
      raided: a.raided,
      // Derivado no shared, nunca aqui: o job e a tela têm que responder a
      // mesma coisa, e o que está em jogo é a reputação de gente.
      state: toAttendanceState(signup, a.raided, hasSignups, signupDeclared),
      firstPull: a.firstPull,
      pulls: a.pulls,
      note: a.note,
    };
  }

  /**
   * Data de hoje no fuso da guilda, como corte superior da leitura.
   *
   * A noite de hoje entra mesmo antes de começar — é a raid que o oficial está
   * olhando à tarde, e ela já tem os signups. O que fica de fora é sábado que
   * vem. `en-CA` porque devolve `YYYY-MM-DD`, o formato gravado.
   */
  private hoje(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  /** O banco guarda texto; o contrato é enum. Valor estranho vira null. */
  private signup(valor: string | null): SignupStatus | null {
    if (valor === null) return null;
    const parsed = signupStatusSchema.safeParse(valor);
    return parsed.success ? parsed.data : null;
  }
}
