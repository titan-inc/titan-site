import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { RaidProgressReport } from '@titan/shared';
import { MemberGuard } from '../auth/session.guard';
import { RaidProgressService } from './raidprogress.service';

/**
 * Progressão de raid do tier. Área interna, então guard próprio — Regra 5.
 *
 * `MemberGuard` e não o gate de oficial: o relatório é da **guilda** (que boss
 * morreu, quando, em quantas pulls) e não traz nada sobre pessoas. A restrição
 * de visibilidade da Regra 7 é sobre histórico individual, que não entra aqui.
 */
@Controller('internal/raid-progress')
@UseGuards(MemberGuard)
export class RaidProgressController {
  constructor(private readonly raid: RaidProgressService) {}

  @Get()
  getReport(@Query('season') season?: string): Promise<RaidProgressReport | null> {
    const id = season && /^\d+$/.test(season) ? Number(season) : undefined;
    return this.raid.getReport(id);
  }
}
