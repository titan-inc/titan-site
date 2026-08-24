import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface RaidNightInput {
  id: number;
  date: string;
  title: string;
  instance: string;
  difficulty: string;
  optional: boolean;
  seasonId: number | null;
  reportCodes: string[];
  bossPulls: number | null;
  hasSignups: boolean;
}

export interface AttendanceInput {
  /** Identidade já resolvida — quem resolve é o `CharactersRepository`. */
  characterId: string;
  signup: string | null;
  raided: boolean | null;
  firstPull: number | null;
  pulls: number | null;
}

/** Único lugar do módulo attendance que fala com o Prisma — ver Regra 3. */
@Injectable()
export class AttendanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava a noite e a presença de todo mundo nela.
   *
   * **Nunca toca em `note`, `noteBy` e `noteAt`.** Essa é a anotação do raid
   * leader, e reprocessar a noite não pode apagar o motivo que ele escreveu —
   * o que fica no banco é a correção do humano, nunca a inferência.
   *
   * Numa transação porque uma noite gravada pela metade é pior que uma noite
   * não gravada: a tela mostraria meia raid faltando.
   */
  async saveNight(night: RaidNightInput, entries: AttendanceInput[]): Promise<number> {
    const { id, ...resto } = night;

    await this.prisma.$transaction([
      this.prisma.raidNight.upsert({
        where: { id },
        create: { id, ...resto },
        update: resto,
      }),

      ...entries.map((e) => {
        const { characterId, ...campos } = e;
        return this.prisma.raidAttendance.upsert({
          where: {
            raidNightId_characterId: { raidNightId: id, characterId },
          },
          create: { raidNightId: id, characterId, ...campos },
          update: campos,
        });
      }),
    ]);

    return entries.length;
  }

  /** Noites com o detalhe de todo mundo. Só oficial chega aqui — Regra 7. */
  listNights(limite: number) {
    return this.prisma.raidNight.findMany({
      orderBy: { date: 'desc' },
      take: limite,
      include: {
        attendance: { include: { character: true }, orderBy: [{ character: { name: 'asc' } }] },
      },
    });
  }

  /**
   * Histórico dos personagens de UMA conta.
   *
   * Existe separado de `listNights` porque a Regra 7 é explícita: membro vê o
   * próprio histórico inteiro, e não o de outro membro. **O filtro é no banco**,
   * não na tela — assim o dado dos outros nem trafega, e um bug de render não
   * vira vazamento.
   *
   * Recebe a lista de ids porque uma conta tem N personagens, e o histórico da
   * pessoa é o de todos eles juntos. Ver Regra 4.
   */
  listForCharacters(characterIds: string[], limite: number) {
    if (characterIds.length === 0) return Promise.resolve([]);

    return this.prisma.raidAttendance.findMany({
      where: { characterId: { in: characterIds } },
      orderBy: { raidNight: { date: 'desc' } },
      take: limite,
      include: { raidNight: true, character: true },
    });
  }

  /**
   * Grava a anotação do raid leader.
   *
   * Só os campos de anotação. O resto da linha é fato coletado e não se edita
   * à mão — o humano corrige o **significado**, não o observado.
   */
  async saveNote(id: string, note: string | null, by: string) {
    return this.prisma.raidAttendance.update({
      where: { id },
      data: {
        note,
        // Apagar a nota apaga a autoria junto; guardar quem escreveu um texto
        // que não existe mais não serve para nada.
        noteBy: note === null ? null : by,
        noteAt: note === null ? null : new Date(),
      },
    });
  }
}
