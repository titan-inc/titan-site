import { Injectable } from '@nestjs/common';
import type { MplusVaga, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** A vaga com o battletag de quem anunciou, que vem do join. */
export type VagaComAutor = MplusVaga & { user: { battletag: string } };

export interface CriarVagaInput {
  userId: string;
  tank: number;
  healer: number;
  dps: number;
  quando: Date;
  keyMin: number;
  keyMax: number;
  semLust: boolean;
  semBrez: boolean;
  observacao?: string;
}

const comAutor = { user: { select: { battletag: true } } } satisfies Prisma.MplusVagaInclude;

/**
 * Único lugar do módulo mplus que fala com o Prisma — Regra 3.
 */
@Injectable()
export class MplusRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava a vaga **antes** da entrega, com `entregue` em falso.
   *
   * A ordem é o desenho, não detalhe: gravar depois perderia justamente o caso
   * que interessa registrar — a vaga cuja mensagem não chegou ao Discord.
   */
  async criar(input: CriarVagaInput): Promise<VagaComAutor> {
    return this.prisma.mplusVaga.create({ data: input, include: comAutor });
  }

  async marcarEntregue(id: string): Promise<void> {
    await this.prisma.mplusVaga.update({ where: { id }, data: { entregue: true } });
  }

  /**
   * As vagas que ainda valem, da mais próxima para a mais distante.
   *
   * A janela de tolerância existe porque grupo não se monta no minuto marcado:
   * sumir da tela às 21h01 tiraria do ar um anúncio que ainda está sendo
   * respondido no Discord.
   *
   * Nenhum filtro por faixa de key, e isso é decisão: a faixa é rótulo, não
   * critério. Esconder por key esconderia exatamente o convite que seria
   * aceito.
   */
  async listar(desde: Date): Promise<VagaComAutor[]> {
    return this.prisma.mplusVaga.findMany({
      where: { quando: { gte: desde } },
      orderBy: { quando: 'asc' },
      include: comAutor,
    });
  }

  /** Null quando não existe — o service traduz para 404. */
  async findById(id: string): Promise<VagaComAutor | null> {
    return this.prisma.mplusVaga.findUnique({ where: { id }, include: comAutor });
  }

  async apagar(id: string): Promise<void> {
    await this.prisma.mplusVaga.delete({ where: { id } });
  }

  /** Devolve quantas linhas o expurgo levou, para o job registrar. */
  async apagarCriadasAntesDe(limite: Date): Promise<number> {
    const { count } = await this.prisma.mplusVaga.deleteMany({
      where: { createdAt: { lt: limite } },
    });
    return count;
  }
}
