import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  addLootSessionItemSchema,
  changeLootSessionStatusSchema,
  createLootSessionSchema,
  respondToLootItemSchema,
  type AddLootSessionItem,
  type RespondToLootItem,
  type ChangeLootSessionStatus,
  type CreateLootSession,
  type CreateLootSessionResult,
  type LootSessionDetail,
  type LootSessionSummary,
  type SessionUser,
} from '@titan/shared';
import type { Request } from 'express';
import { MemberGuard, OfficerGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LootSessionsService, type PersonagemDaConta } from './loot-sessions.service';
import type { Ator } from './loot-sessions.repository';

/**
 * Quem está agindo, do que os guards deixaram no request.
 *
 * O `id` vem de `req.account` (a conta inteira) e não de `req.user`, que é o
 * `SessionUser` e só carrega battletag. Os dois são gravados juntos: o id liga,
 * o battletag deixa a auditoria legível sem join.
 */
type ComSessao = Request & {
  user: SessionUser;
  account: { id: string; characters: PersonagemDaConta[] };
};

function ator(req: Request): Ator {
  const { user, account } = req as ComSessao;
  return { userId: account.id, battletag: user.battletag };
}

/**
 * TODOS os personagens da conta no roster, não só o representante.
 *
 * Quem raida em dois chars respondeu com um deles, e olhar só o representante
 * mostraria "você não respondeu" para quem já respondeu no alt — e a pessoa
 * responderia duas vezes. Ver Regra 4: o agregado é por pessoa.
 */
function personagens(req: Request): PersonagemDaConta[] {
  return (req as ComSessao).account.characters;
}

/**
 * A sessão de loot council.
 *
 * **Leitura é de membro, escrita é de oficial.** Quem cria a sessão é o loot
 * master, e loot master não é papel no sistema: é quem iniciou, e quem pode
 * iniciar é oficial — decidido aqui pelo `OfficerGuard`, sem modelo novo.
 *
 * Todo mundo da área interna lê, porque todo mundo vai responder aos itens (ver
 * TIT-65: participação é `canAccessInternalArea()`, sem gate novo).
 */
@Controller('internal/loot-sessions')
export class LootSessionsController {
  constructor(private readonly sessions: LootSessionsService) {}

  /** As sessões que ainda não encerraram. É o que a aba de Sessão abre. */
  @Get()
  @UseGuards(MemberGuard)
  listar(): Promise<LootSessionSummary[]> {
    return this.sessions.listarAbertas();
  }

  /**
   * A sessão do ponto de vista de quem pediu.
   *
   * Traz a **própria** resposta e o **próprio** roll, mais quantas pessoas já
   * responderam a cada peça. Resposta alheia não sai daqui enquanto a sessão
   * corre — ver `detalhe()` no serviço.
   */
  @Get(':id')
  @UseGuards(MemberGuard)
  detalhe(@Param('id') id: string, @Req() req: Request): Promise<LootSessionDetail> {
    return this.sessions.detalhe(id, personagens(req));
  }

  /**
   * O jogador declara o que quer para uma peça.
   *
   * `MemberGuard`, sem gate novo: quem responde é quem entra na área interna,
   * que é exatamente o time de raid. Se alguém que não estava na raid responder,
   * o desenho se protege sozinho — o jogador dá resposta, quem dá voto é o
   * conselho, e ninguém leva item sem voto.
   */
  @Post(':id/itens/:itemId/resposta')
  @UseGuards(MemberGuard)
  responder(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(respondToLootItemSchema)) body: RespondToLootItem,
    @Req() req: Request,
  ): Promise<LootSessionDetail> {
    return this.sessions.responder(id, itemId, body, ator(req), personagens(req));
  }

  /**
   * O loot master cola e a sessão nasce montada.
   *
   * A colagem vai como TEXTO CRU: quem interpreta é a API, pela Regra 1. Assim o
   * front não precisa saber nada sobre o formato do addon, e o dia em que o
   * addon mudar de versão só um lado muda.
   */
  @Post()
  @UseGuards(OfficerGuard)
  criar(
    @Body(new ZodValidationPipe(createLootSessionSchema)) body: CreateLootSession,
    @Req() req: Request,
  ): Promise<CreateLootSessionResult> {
    return this.sessions.criarDaColagem(body.paste, ator(req), personagens(req));
  }

  /** Acrescenta a peça que o addon perdeu. Só em rascunho. */
  @Post(':id/itens')
  @UseGuards(OfficerGuard)
  adicionarItem(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addLootSessionItemSchema)) body: AddLootSessionItem,
    @Req() req: Request,
  ): Promise<LootSessionDetail> {
    return this.sessions.adicionarItem(id, body, ator(req), personagens(req));
  }

  @Delete(':id/itens/:itemId')
  @UseGuards(OfficerGuard)
  removerItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Req() req: Request,
  ): Promise<LootSessionDetail> {
    return this.sessions.removerItem(id, itemId, ator(req), personagens(req));
  }

  /**
   * Avança (ou reabre) a sessão.
   *
   * Uma rota só para todas as transições, e não `/abrir`, `/deliberar`,
   * `/encerrar`: quem decide o que é permitido é `podeTransicionar()` no shared,
   * e uma rota por transição espalharia a mesma regra por quatro lugares.
   */
  @Post(':id/status')
  @UseGuards(OfficerGuard)
  trocarStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeLootSessionStatusSchema, 'Status'))
    body: ChangeLootSessionStatus,
    @Req() req: Request,
  ): Promise<LootSessionDetail> {
    return this.sessions.trocarStatus(id, body.status, ator(req), personagens(req));
  }
}
