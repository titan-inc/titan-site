import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { AttendanceReport, SessionUser } from '@titan/shared';
import type { Request } from 'express';
import { OfficerGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AttendanceReportService } from './attendance-report.service';
import { AttendanceService, type SyncResult } from './attendance.service';

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
  constructor(
    private readonly report: AttendanceReportService,
    private readonly ingestao: AttendanceService,
  ) {}

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

  /**
   * Relê uma noite do WoWAudit e do WCL agora.
   *
   * O raid leader corrige os signups no WoWAudit no dia seguinte; sem isto, a
   * correção só aparece na rodada das 11h ou se um dev disparar a rota de ops —
   * e o processo não pode depender de alguém estar disponível (Regra 4).
   *
   * 502 quando a fonte falha: a noite continua como estava, e a tela tem que
   * dizer isso em vez de recarregar como se tivesse atualizado.
   */
  @Post('nights/:raidId/sync')
  @UseGuards(OfficerGuard)
  async syncNight(@Param('raidId', ParseIntPipe) raidId: number): Promise<SyncResult> {
    let resultado: SyncResult | null;
    try {
      resultado = await this.ingestao.syncNight(raidId);
    } catch (err: unknown) {
      throw new BadGatewayException(err instanceof Error ? err.message : String(err));
    }

    if (!resultado) throw new NotFoundException(`Raid ${raidId} não existe no WoWAudit`);
    return resultado;
  }
}
