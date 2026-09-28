import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { AttendanceReport, SessionUser } from '@titan/shared';
import type { Request } from 'express';
import { OfficerGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AttendanceReportService } from './attendance-report.service';

const noteSchema = z.object({
  /** Vazio apaga a anotação. Limite alto o bastante para um parágrafo. */
  note: z.string().max(500),
});

/**
 * Presença de raid. **Só oficial**, em todas as rotas.
 *
 * Havia um `/me` com o próprio histórico, sob `MemberGuard`. Saiu: os players
 * não entram no site, e a tela virou ferramenta de trabalho do raid leader —
 * rotação de banco, que é explicitamente não-pública. Ver TIT-150 e a Regra 7
 * do CLAUDE.md, que registra a reversão.
 */
@Controller('internal/attendance')
export class AttendanceController {
  constructor(private readonly report: AttendanceReportService) {}

  @Get()
  @UseGuards(OfficerGuard)
  getReport(): Promise<AttendanceReport> {
    return this.report.getReport();
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
