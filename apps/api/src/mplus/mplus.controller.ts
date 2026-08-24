import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { criarVagaSchema, type CriarVaga, type Vaga, type VagaList } from '@titan/shared';
import type { Request } from 'express';
import type { UserWithCharacters } from '../auth/auth.repository';
import { RosterGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MplusService } from './mplus.service';

/**
 * Vagas de M+ — ver `docs/specs/mplus-vaga-discord.md`.
 *
 * `RosterGuard`, e **não** `MemberGuard`: M+ não é raid, e o corte de
 * `GUILD_RANK_ACCESS_MAX` não deve filtrar nada aqui. Qualquer pessoa com
 * personagem no roster anuncia — inclusive quem está acima do corte, que é
 * justamente quem até agora não recebia nada do site (Regra 4, o estado do
 * meio).
 *
 * O guard é o que vale; o proxy do Next é só UX (Regra 5).
 */
@Controller('internal/mplus/vagas')
@UseGuards(RosterGuard)
export class MplusController {
  constructor(private readonly mplus: MplusService) {}

  @Get()
  listar(@Req() req: Request): Promise<VagaList> {
    return this.mplus.listar(contaDe(req).id);
  }

  @Get(':id')
  obter(@Param('id') id: string, @Req() req: Request): Promise<Vaga> {
    return this.mplus.obter(id, contaDe(req).id);
  }

  @Post()
  criar(
    @Body(new ZodValidationPipe(criarVagaSchema)) body: CriarVaga,
    @Req() req: Request,
  ): Promise<Vaga> {
    return this.mplus.criar(body, contaDe(req).id);
  }

  /**
   * Apaga do site. A mensagem publicada no Discord **fica** — ver o service.
   */
  @Delete(':id')
  @HttpCode(204)
  async apagar(@Param('id') id: string, @Req() req: Request): Promise<void> {
    await this.mplus.apagar(id, contaDe(req).id);
  }
}

/**
 * A conta, populada pelo guard.
 *
 * Dono da vaga é o **id da conta**, nunca o battletag: battletag a pessoa
 * troca, e trocar não pode transferir nem perder a vaga.
 */
function contaDe(req: Request): UserWithCharacters {
  return (req as Request & { account: UserWithCharacters }).account;
}
