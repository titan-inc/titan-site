import { Body, Controller, Delete, Get, Param, Post, Req, Sse, UseGuards } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import {
  addLootSessionItemSchema,
  changeLootSessionStatusSchema,
  entrarNaSessaoSchema,
  alterarRespostaSchema,
  awardarSchema,
  awardPorMaioriaSchema,
  passItemToSchema,
  createLootSessionSchema,
  reabrirRespostaSchema,
  respondToLootItemSchema,
  votarSchema,
  type AddLootSessionItem,
  type RespondToLootItem,
  type ChangeLootSessionStatus,
  type CreateLootSession,
  type EntrarNaSessao,
  type AlterarResposta,
  type Awardar,
  type AwardEmMassaResultado,
  type AwardPorMaioria,
  type PassItemTo,
  type CreateLootSessionResult,
  type LootCouncilPanel,
  type ReabrirResposta,
  type Votar,
  type LootSessionDetail,
  type LootSessionSummary,
  type SessionUser,
} from '@titan/shared';
import type { Request } from 'express';
import { MemberGuard, OfficerGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LootCouncilService } from './loot-council.service';
import { LootSessionChangeBus } from './loot-session-change-bus';
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
  constructor(
    private readonly sessions: LootSessionsService,
    private readonly council: LootCouncilService,
    private readonly changes: LootSessionChangeBus,
  ) {}

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
    return this.sessions.detalhe(id, ator(req));
  }

  /**
   * O aviso de que a sessão mudou — TIT-68. Nunca dado, só "mudou": quem
   * recebe chama `router.refresh()`, que já é o caminho testado em raid.
   *
   * `MemberGuard` de novo, igual a qualquer rota: `@Sse()` é rota normal, e
   * o teste da Regra 5 vale igual — chamado sem cookie devolve 401.
   */
  @Sse(':id/mudancas')
  @UseGuards(MemberGuard)
  async mudancas(@Param('id') id: string): Promise<Observable<MessageEvent>> {
    await this.sessions.exigirQueExista(id);
    return this.changes.abrirStream(id);
  }

  /**
   * Entrar na sessão, com o personagem daquela noite.
   *
   * Ato explícito: abrir a tela não põe ninguém na raid. É daqui que a resposta
   * herda o personagem, então sem entrar não se responde.
   */
  @Post(':id/entrar')
  @UseGuards(MemberGuard)
  entrar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(entrarNaSessaoSchema)) body: EntrarNaSessao,
    @Req() req: Request,
  ): Promise<LootSessionDetail> {
    return this.sessions.entrar(id, body, ator(req), personagens(req));
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
    return this.sessions.responder(id, itemId, body, ator(req));
  }

  /**
   * O painel do conselho — a metade de cima da tela.
   *
   * Rota própria, e não um campo do detalhe: se fosse campo, o payload do membro
   * carregaria as respostas de todo mundo e a tela só esconderia. O teste da
   * Regra 5 é "chamado sem permissão devolve 403?", e aqui devolve.
   */
  @Get(':id/painel')
  @UseGuards(OfficerGuard)
  painel(@Param('id') id: string, @Req() req: Request): Promise<LootCouncilPanel> {
    return this.council.painel(id, ator(req));
  }

  /** O voto do conselheiro. Um por conselheiro por peça; votar de novo troca. */
  @Post(':id/itens/:itemId/voto')
  @UseGuards(OfficerGuard)
  async votar(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(votarSchema)) body: Votar,
    @Req() req: Request,
  ): Promise<LootCouncilPanel> {
    await this.council.votar(id, itemId, body, ator(req));
    return this.council.painel(id, ator(req));
  }

  /** Pede para alguém responder de novo. É o escape do `deliberando`. */
  @Post(':id/itens/:itemId/reabrir')
  @UseGuards(OfficerGuard)
  async reabrirResposta(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(reabrirRespostaSchema)) body: ReabrirResposta,
    @Req() req: Request,
  ): Promise<LootCouncilPanel> {
    await this.council.reabrirResposta(id, itemId, body, ator(req));
    return this.council.painel(id, ator(req));
  }

  /** O conselho corrige a resposta de alguém. Vira evento com autor. */
  @Post(':id/itens/:itemId/resposta-do-conselho')
  @UseGuards(OfficerGuard)
  async alterarResposta(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(alterarRespostaSchema)) body: AlterarResposta,
    @Req() req: Request,
  ): Promise<LootCouncilPanel> {
    await this.council.alterarResposta(id, itemId, body, ator(req));
    return this.council.painel(id, ator(req));
  }

  /** O conselho entrega a peça a uma pessoa específica. */
  @Post(':id/itens/:itemId/award')
  @UseGuards(OfficerGuard)
  async awardar(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(awardarSchema)) body: Awardar,
    @Req() req: Request,
  ): Promise<LootCouncilPanel> {
    await this.council.awardar(id, itemId, body, ator(req));
    return this.council.painel(id, ator(req));
  }

  /**
   * A peça vai para alguém por decisão do loot master, não por interesse.
   *
   * Rota própria, e não um campo do `/award`: lá só quem se candidatou, e
   * congela a declaração dela; aqui qualquer participante, e congela a razão de
   * quem entregou. É a saída da peça que ninguém pediu.
   */
  @Post(':id/itens/:itemId/pass-item-to')
  @UseGuards(OfficerGuard)
  async passItemTo(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(passItemToSchema)) body: PassItemTo,
    @Req() req: Request,
  ): Promise<LootCouncilPanel> {
    await this.council.passItemTo(id, itemId, body, ator(req));
    return this.council.painel(id, ator(req));
  }

  /**
   * Entrega por maioria: uma peça com `itemId`, ou todas as pendentes sem ele.
   *
   * Devolve o painel **e** o resultado: o que foi entregue e o que foi pulado,
   * com o motivo. Entregar 3 de 7 sem dizer o que houve com as outras 4 faria o
   * loot master descobrir na hora de encerrar.
   */
  @Post(':id/award-por-maioria')
  @UseGuards(OfficerGuard)
  async awardarPorMaioria(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(awardPorMaioriaSchema)) body: AwardPorMaioria,
    @Req() req: Request,
  ): Promise<{ resultado: AwardEmMassaResultado; painel: LootCouncilPanel }> {
    const resultado = await this.council.awardarPorMaioria(id, body, ator(req));
    return { resultado, painel: await this.council.painel(id, ator(req)) };
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
    return this.sessions.criarDaColagem(body.paste, ator(req));
  }

  /** Acrescenta a peça que o addon perdeu. Só em rascunho. */
  @Post(':id/itens')
  @UseGuards(OfficerGuard)
  adicionarItem(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addLootSessionItemSchema)) body: AddLootSessionItem,
    @Req() req: Request,
  ): Promise<LootSessionDetail> {
    return this.sessions.adicionarItem(id, body, ator(req));
  }

  @Delete(':id/itens/:itemId')
  @UseGuards(OfficerGuard)
  removerItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Req() req: Request,
  ): Promise<LootSessionDetail> {
    return this.sessions.removerItem(id, itemId, ator(req));
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
    return this.sessions.trocarStatus(id, body.status, ator(req));
  }
}
