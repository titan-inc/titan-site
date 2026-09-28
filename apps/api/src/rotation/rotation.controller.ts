import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createPlayerLockSchema,
  savePlanSchema,
  setRoleLocksSchema,
  type CreatePlayerLock,
  type RotationView,
  type SavePlan,
  type SessionUser,
  type SetRoleLocks,
} from '@titan/shared';
import type { Request } from 'express';
import { OfficerGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RotationService } from './rotation.service';

/**
 * Rotação de banco — **tudo sob `OfficerGuard`**, sem exceção.
 *
 * Não é o corte da área interna: o banco planejado não pode chegar a quem vai
 * ser sentado. Quando a liderança diz que alguém senta, espera que a pessoa
 * apareça mesmo assim, para o caso de precisar trocar; saber antes faz a pessoa
 * não aparecer. Ver a Regra 7 do CLAUDE.md.
 *
 * Toda escrita devolve a view inteira, e não o item criado: a tela vai
 * renderizar tudo de novo de qualquer jeito, e uma sugestão recalculada só em
 * parte divergiria do resto em silêncio.
 */
@Controller('internal/rotation')
@UseGuards(OfficerGuard)
export class RotationController {
  constructor(private readonly rotation: RotationService) {}

  @Get()
  getView(@Query('semana') semana?: string): Promise<RotationView> {
    return this.rotation.getView(semana);
  }

  @Put('role-locks')
  setRoleLocks(
    @Body(new ZodValidationPipe(setRoleLocksSchema)) body: SetRoleLocks,
    @Req() req: Request,
  ): Promise<RotationView> {
    return this.rotation.setRoleLocks(body.roles, this.autor(req));
  }

  @Post('player-locks')
  createPlayerLock(
    @Body(new ZodValidationPipe(createPlayerLockSchema)) body: CreatePlayerLock,
    @Req() req: Request,
  ): Promise<RotationView> {
    return this.rotation.createPlayerLock(body, this.autor(req));
  }

  @Delete('player-locks/:id')
  deletePlayerLock(@Param('id') id: string): Promise<RotationView> {
    return this.rotation.deletePlayerLock(id);
  }

  @Put('plan')
  savePlan(
    @Body(new ZodValidationPipe(savePlanSchema)) body: SavePlan,
    @Req() req: Request,
  ): Promise<RotationView> {
    return this.rotation.savePlan(body, this.autor(req));
  }

  /** Decidir quem senta não pode ser ação anônima — mesma régua do OfficerGrant. */
  private autor(req: Request): string {
    return (req as Request & { user: SessionUser }).user.battletag;
  }
}
