import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VAGA_EXPURGO_DIAS, type CriarVaga, type Vaga, type VagaList } from '@titan/shared';
import { loadGuildConfig, type GuildConfig } from '../config/guild.config';
import { DiscordDeliveryError, DiscordService } from '../discord/discord.service';
import { buildVagaEmbed } from './embed';
import { MplusRepository, type VagaComAutor } from './mplus.repository';

const DIA_MS = 24 * 60 * 60 * 1_000;

/**
 * Quanto tempo uma vaga continua na lista depois da hora marcada.
 *
 * Grupo não se monta no minuto combinado: sumir às 21h01 tiraria da tela um
 * anúncio que ainda está sendo respondido no Discord.
 */
const TOLERANCIA_MS = 3 * 60 * 60 * 1_000;

@Injectable()
export class MplusService {
  private readonly logger = new Logger(MplusService.name);
  private readonly guild: GuildConfig;

  constructor(
    private readonly repo: MplusRepository,
    private readonly discord: DiscordService,
  ) {
    this.guild = loadGuildConfig();
  }

  /**
   * Cria a vaga e anuncia no Discord, **nesta ordem**.
   *
   * A linha nasce com `entregue: false` e só é marcada depois que o Discord
   * aceita. Se a entrega falhar, a vaga existe e aparece na tela como não
   * publicada — o erro é honesto, e nunca se responde sucesso para mensagem que
   * não chegou.
   *
   * Recebe só o id da conta: o battletag que vai no anúncio vem do join, não do
   * chamador, para ser sempre o atual mesmo que a pessoa o tenha trocado.
   */
  async criar(dto: CriarVaga, userId: string): Promise<Vaga> {
    const linha = await this.repo.criar({
      userId,
      tank: dto.vagas.tank,
      healer: dto.vagas.healer,
      dps: dto.vagas.dps,
      quando: new Date(dto.quando),
      keyMin: dto.keyMin,
      keyMax: dto.keyMax,
      semLust: dto.faltando.includes('lust'),
      semBrez: dto.faltando.includes('brez'),
      ...(dto.observacao?.trim() ? { observacao: dto.observacao.trim() } : {}),
    });

    const vaga = toVaga(linha, userId);

    try {
      await this.discord.send('mplus', this.montarEmbed(vaga));
    } catch (error: unknown) {
      // A vaga fica gravada, e não entregue. É o estado que a spec quer poder
      // existir: sem a linha, ninguém saberia que houve um anúncio perdido.
      this.logger.warn(`Vaga ${vaga.id} gravada, mas não entregue ao Discord.`);
      throw this.traduzirFalha(error);
    }

    await this.repo.marcarEntregue(vaga.id);
    this.logger.log(`Vaga ${vaga.id} anunciada no Discord.`);
    return { ...vaga, entregue: true };
  }

  async listar(userId: string): Promise<VagaList> {
    const linhas = await this.repo.listar(new Date(Date.now() - TOLERANCIA_MS));
    return { vagas: linhas.map((linha) => toVaga(linha, userId)) };
  }

  /** A página que o post do Discord linka. */
  async obter(id: string, userId: string): Promise<Vaga> {
    const linha = await this.repo.findById(id);
    if (!linha) throw new NotFoundException(vagaSumiuMsg());
    return toVaga(linha, userId);
  }

  /**
   * Apagar tira do **site**, e só.
   *
   * A mensagem já publicada continua no canal, e quem apaga vai continuar
   * recebendo resposta lá — recolher o anúncio exigiria guardar o id da
   * mensagem e chamar o Discord de volta, o que está fora de escopo. A tela
   * precisa dizer isso em vez de fingir que recolhe.
   */
  async apagar(id: string, userId: string): Promise<void> {
    const linha = await this.repo.findById(id);
    if (!linha) throw new NotFoundException(vagaSumiuMsg());

    if (linha.userId !== userId) {
      throw new ForbiddenException('Só quem criou a vaga pode apagá-la.');
    }

    await this.repo.apagar(id);
  }

  /**
   * Faxina diária: a vaga vira lixo depois que a noite passa.
   *
   * Conta da **criação**, não de `quando` — e é por isso que o schema limita o
   * agendamento a menos dias do que esta janela. Se alguém afrouxar um dos dois
   * números sozinho, vagas passam a sumir antes da noite acontecer, em
   * silêncio.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'expurgo-de-vagas-mplus' })
  async expurgoScheduled(): Promise<void> {
    try {
      const apagadas = await this.expurgar();
      if (apagadas > 0) this.logger.log(`Expurgo de vagas de M+: ${String(apagadas)} apagadas.`);
    } catch (err: unknown) {
      // Exceção aqui viraria unhandled rejection no @nestjs/schedule e
      // derrubaria o processo por causa de uma faxina.
      this.logger.error(
        `Expurgo de vagas falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async expurgar(agora: Date = new Date()): Promise<number> {
    return this.repo.apagarCriadasAntesDe(new Date(agora.getTime() - VAGA_EXPURGO_DIAS * DIA_MS));
  }

  private montarEmbed(vaga: Vaga) {
    return buildVagaEmbed(vaga, {
      webUrl: process.env.WEB_URL ?? 'http://localhost:3000',
      timezone: this.guild.timezone,
      ...(this.discord.mplusRoleId ? { roleId: this.discord.mplusRoleId } : {}),
    });
  }

  /** Mesma classificação do apply, com o texto desta tela. */
  private traduzirFalha(error: unknown): Error {
    if (!(error instanceof DiscordDeliveryError)) return error as Error;

    if (error.kind === 'unconfigured' || error.kind === 'configuration') {
      return new ServiceUnavailableException(
        'O canal de M+ não está configurado. A vaga foi salva, mas não foi anunciada.',
      );
    }

    if (error.kind === 'rate-limit') {
      return new ServiceUnavailableException(
        'O Discord está limitando os envios. A vaga foi salva, mas não foi anunciada.',
      );
    }

    if (error.kind === 'upstream') {
      return new BadGatewayException(
        'Não foi possível anunciar no Discord agora. A vaga foi salva, mas não foi anunciada.',
      );
    }

    return new InternalServerErrorException();
  }
}

function vagaSumiuMsg(): string {
  return `Vaga não encontrada. Vagas somem do site ${String(VAGA_EXPURGO_DIAS)} dias depois de criadas.`;
}

/**
 * Linha do banco → contrato do shared.
 *
 * `podeApagar` é calculado aqui, contra quem está lendo: a tela não deve
 * oferecer um botão que a API vai recusar.
 */
function toVaga(linha: VagaComAutor, userId: string): Vaga {
  return {
    id: linha.id,
    vagas: { tank: linha.tank, healer: linha.healer, dps: linha.dps },
    quando: linha.quando.toISOString(),
    keyMin: linha.keyMin,
    keyMax: linha.keyMax,
    faltando: [
      ...(linha.semLust ? (['lust'] as const) : []),
      ...(linha.semBrez ? (['brez'] as const) : []),
    ],
    ...(linha.observacao ? { observacao: linha.observacao } : {}),
    criadaPor: linha.user.battletag,
    criadaEm: linha.createdAt.toISOString(),
    entregue: linha.entregue,
    podeApagar: linha.userId === userId,
  };
}
