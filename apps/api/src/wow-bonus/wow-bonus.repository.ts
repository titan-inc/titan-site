import { Injectable } from '@nestjs/common';
import type { Prisma, WowBonusTertiary } from '@prisma/client';
import type { BonusDictionaryEntry } from '@titan/shared';
import { PrismaService } from '../prisma/prisma.service';

const bonusSelect = {
  bonusId: true,
  kind: true,
  trackName: true,
  trackRank: true,
  trackMaxRank: true,
  tertiary: true,
} as const;

export type WowBonusRow = Prisma.WowBonusGetPayload<{ select: typeof bonusSelect }>;

/**
 * Único lugar do módulo `wow-bonus` que toca o Prisma — Regra 3.
 */
@Injectable()
export class WowBonusRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava o dicionário, uma entrada por vez, casando por `bonusId`.
   *
   * `upsert` e não `createMany`: o arquivo é a fonte da verdade — recarregar
   * depois de corrigir uma entrada tem que ATUALIZAR a linha, não recusar por
   * chave duplicada. Mesmo precedente do `LootCatalogRepository.upsertRaid`.
   */
  async upsertMany(entradas: BonusDictionaryEntry[]): Promise<void> {
    await this.prisma.$transaction(
      entradas.map((entrada) => {
        const { bonusId, ...campos } = paraColunas(entrada);
        return this.prisma.wowBonus.upsert({
          where: { bonusId },
          create: { bonusId, ...campos },
          update: campos,
        });
      }),
    );
  }

  /** As entradas destes bonus IDs — o que existir. Ausente é desconhecido. */
  findByIds(bonusIds: number[]): Promise<WowBonusRow[]> {
    if (bonusIds.length === 0) return Promise.resolve([]);

    return this.prisma.wowBonus.findMany({
      where: { bonusId: { in: bonusIds } },
      select: bonusSelect,
    });
  }

  /** Todo bonus ID que o dicionário já conhece — para o relatório de desconhecidos. */
  async findAllIds(): Promise<Set<number>> {
    const linhas = await this.prisma.wowBonus.findMany({ select: { bonusId: true } });
    return new Set(linhas.map((l) => l.bonusId));
  }
}

/**
 * A entrada do arquivo (union discriminada) vira as colunas nuláveis da
 * tabela. O campo que não pertence ao `kind` some — nunca sobra lixo de um
 * `kind` anterior numa recarga, porque o objeto inteiro é reescrito.
 */
function paraColunas(entrada: BonusDictionaryEntry): {
  bonusId: number;
  kind: BonusDictionaryEntry['kind'];
  trackName: string | null;
  trackRank: number | null;
  trackMaxRank: number | null;
  tertiary: WowBonusTertiary | null;
} {
  return {
    bonusId: entrada.bonusId,
    kind: entrada.kind,
    trackName: entrada.kind === 'track' ? entrada.trackName : null,
    trackRank: entrada.kind === 'track' ? entrada.trackRank : null,
    trackMaxRank: entrada.kind === 'track' ? entrada.trackMaxRank : null,
    tertiary: entrada.kind === 'tertiary' ? entrada.tertiary : null,
  };
}
