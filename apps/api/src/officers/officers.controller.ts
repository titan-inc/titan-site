import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { createOfficerGrantSchema, type CreateOfficerGrant, type OfficerList } from '@titan/shared';
import type { Request } from 'express';
import type { SessionUser } from '@titan/shared';
import { OfficerGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { OfficersService } from './officers.service';

/**
 * Quem é oficial — a lista manual da Regra 4.
 *
 * Todos os endpoints sob `OfficerGuard`: só oficial concede e revoga oficial.
 * É circular de propósito. A alternativa seria derivar de rank, que é
 * exatamente o que a Regra 4 proíbe, e o custo dessa circularidade — precisar
 * de um `INSERT` manual para o primeiro oficial — se paga uma vez na vida.
 *
 * Não existe endpoint que leia isto sem ser oficial: a lista diz quem tem
 * acesso a dado pessoal de candidato, e isso não é informação pública da
 * guilda.
 */
@Controller('internal/officers')
@UseGuards(OfficerGuard)
export class OfficersController {
  constructor(private readonly officers: OfficersService) {}

  @Get()
  list(): Promise<OfficerList> {
    return this.officers.list();
  }

  /**
   * Concede a um personagem.
   *
   * Devolve a lista inteira, não só o item criado: quem chama vai renderizar a
   * lista de novo de qualquer jeito, e um `linked` calculado só para o item
   * novo divergiria do resto da tela.
   */
  @Post()
  grant(
    @Body(new ZodValidationPipe(createOfficerGrantSchema)) body: CreateOfficerGrant,
    @Req() req: Request,
  ): Promise<OfficerList> {
    const user = (req as Request & { user: SessionUser }).user;
    return this.officers.grant(body, user.battletag);
  }

  @Delete(':id')
  revoke(@Param('id') id: string, @Req() req: Request): Promise<OfficerList> {
    const user = (req as Request & { user: SessionUser }).user;
    return this.officers.revoke(id, user.battletag);
  }
}
