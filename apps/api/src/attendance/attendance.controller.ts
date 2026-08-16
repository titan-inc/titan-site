import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { AttendanceReport, MyAttendance, SessionUser } from '@titan/shared';
import type { Request } from 'express';
import type { UserWithCharacters } from '../auth/auth.repository';
import { MemberGuard, OfficerGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AttendanceReportService } from './attendance-report.service';

const noteSchema = z.object({
  /** Vazio apaga a anotação. Limite alto o bastante para um parágrafo. */
  note: z.string().max(500),
});

/**
 * Presença de raid. Dois gates, e a diferença entre eles é a Regra 7.
 *
 * - `/internal/attendance` — detalhe de todo mundo, **só oficial**.
 * - `/internal/attendance/me` — o próprio histórico, qualquer membro.
 *
 * O recorte de "meu histórico" é feito **no banco**, a partir dos personagens
 * da sessão. O cliente não escolhe de quem é o histórico que quer ver: se
 * escolhesse, o gate seria só decoração.
 */
@Controller('internal/attendance')
export class AttendanceController {
  constructor(private readonly report: AttendanceReportService) {}

  @Get()
  @UseGuards(OfficerGuard)
  getReport(): Promise<AttendanceReport> {
    return this.report.getReport();
  }

  @Get('me')
  @UseGuards(MemberGuard)
  getMine(@Req() req: Request): Promise<MyAttendance> {
    // Populado pelo MemberGuard: a conta com TODOS os personagens no roster.
    // Uma pessoa raida em mais de um char, e o histórico dela é a soma.
    const account = (req as Request & { account: UserWithCharacters }).account;
    return this.report.getMine(account.characters.map((c) => c.characterId));
  }

  /**
   * Anota o motivo de alguém não ter raidado.
   *
   * `PUT` e não `PATCH` porque a operação é idempotente e substitui o texto
   * inteiro — não existe merge parcial de uma anotação.
   */
  @Put(':id/note')
  @UseGuards(OfficerGuard)
  async setNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(noteSchema)) { note }: z.infer<typeof noteSchema>,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const user = (req as Request & { user: SessionUser }).user;

    await this.report.setNote(id, note, user.battletag);
    return { ok: true };
  }
}
