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
   * **E só escreve `signupDeclared` com `congelarDeclarado`.** Mesmo princípio,
   * outro mecanismo: ali o job nunca escreve, aqui ele escreve enquanto a raid
   * não começou e para para sempre depois. Ver `AttendanceService`.
   *
   * Numa transação porque uma noite gravada pela metade é pior que uma noite
   * não gravada: a tela mostraria meia raid faltando.
   *
   * @param congelarDeclarado a raid ainda não começou, então o que está no
   *   WoWAudit é a declaração das pessoas e pode virar `signupDeclared`
   */
  async saveNight(
    night: RaidNightInput,
    entries: AttendanceInput[],
    congelarDeclarado: boolean,
  ): Promise<number> {
    const { id, ...resto } = night;

    await this.prisma.$transaction([
      this.prisma.raidNight.upsert({
        where: { id },
        create: { id, ...resto },
        update: resto,
      }),

      ...entries.map((e) => {
        const { characterId, ...campos } = e;

        // Fora da janela, `signupDeclared` some do payload inteiro — não vai
        // como null. Mandar null apagaria o que já foi congelado, e o dado não
        // volta: a declaração original já não existe mais no WoWAudit.
        const declarado = congelarDeclarado ? { signupDeclared: campos.signup } : {};

        return this.prisma.raidAttendance.upsert({
          where: {
            raidNightId_characterId: { raidNightId: id, characterId },
          },
          // No create o mesmo cuidado, por outro motivo: noite que entra no
          // banco já depois de ter acontecido (backfill) não tem declaração
          // para congelar, e copiar a correção do RL mentiria dizendo que foi
          // isso que a pessoa declarou.
          create: { raidNightId: id, characterId, ...campos, ...declarado },
          update: { ...campos, ...declarado },
        });
      }),
    ]);

    return entries.length;
  }

  /**
   * Noites com o detalhe de todo mundo. Só oficial chega aqui — Regra 7.
   *
   * @param ate data de calendário máxima, no fuso da guilda. O job grava as
   *   raids que ainda vão acontecer (é o que torna o congelamento de
   *   `signupDeclared` repetível), e elas não são presença: entrariam no topo
   *   da lista como noites vazias, empurrando as que aconteceram para fora do
   *   limite. Tela de noite futura é rotação, e é a TIT-152.
   */
  listNights(limite: number, ate: string) {
    return this.prisma.raidNight.findMany({
      where: { date: { lte: ate } },
      orderBy: { date: 'desc' },
      take: limite,
      include: {
        attendance: { include: { character: true }, orderBy: [{ character: { name: 'asc' } }] },
      },
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
