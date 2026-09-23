import { Injectable } from '@nestjs/common';
import type {
  BetAuditSession,
  BetAuditStatus,
  BetCandidateRole,
  BetEncounterTrack,
  BetEventType,
  BetMarketKind,
  BetSlipStatus,
  BetSourceResolution,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Uma linha do snapshot de bettors (D-32, D-38). */
export interface BettorDoReady {
  characterId: string;
  rank: number;
  name: string;
  realm: string;
}

/** Uma linha do snapshot de candidatos (D-33). */
export interface CandidatoDoReady {
  characterId: string;
  role: BetCandidateRole;
  name: string;
  realm: string;
}

export interface GravacaoDoReady {
  roundId: string;
  officer: { userId: string; battletag: string };
  readyAt: Date;
  bettors: BettorDoReady[];
  candidatos: CandidatoDoReady[];
  bettorSourceFetchedAt: Date;
  candidateSourceFetchedAt: Date;
}

/** O que o Ready precisa ler da rodada antes de congelá-la. */
export interface RodadaParaReady {
  id: string;
  cutoffAt: Date;
  readyAt: Date | null;
  markets: Array<{ kind: BetMarketKind }>;
  encounters: Array<{ inWeeklyProgression: boolean }>;
}

/**
 * Único lugar do Titan Bet que toca o Prisma (Regra 3).
 *
 * As invariantes estruturais não moram aqui: estão no banco (CHECK, FK
 * composta, índices parciais e triggers — spec §16.4). O repository só lê e
 * grava; quem recusa o que não pode é o Postgres.
 */
@Injectable()
export class TitanBetRepository {
  constructor(private readonly prisma: PrismaService) {}

  rodadaParaReady(roundId: string): Promise<RodadaParaReady | null> {
    return this.prisma.betRound.findUnique({
      where: { id: roundId },
      select: {
        id: true,
        cutoffAt: true,
        readyAt: true,
        markets: { select: { kind: true } },
        encounters: { select: { inWeeklyProgression: true } },
      },
    });
  }

  /**
   * O configuration freeze (D-31), numa transação só: snapshots e `readyAt`
   * entram juntos ou nada entra.
   *
   * O `readyAt` é gravado por último e só se ainda estiver nulo — dois Ready
   * concorrentes não passam os dois.
   */
  async gravarReady(g: GravacaoDoReady): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.betRoundBettor.createMany({
        data: g.bettors.map((b) => ({ roundId: g.roundId, ...b })),
      });
      await tx.betRoundCandidate.createMany({
        data: g.candidatos.map((c) => ({ roundId: g.roundId, ...c })),
      });

      const pronta = await tx.betRound.updateMany({
        where: { id: g.roundId, readyAt: null },
        data: {
          readyAt: g.readyAt,
          readyByUserId: g.officer.userId,
          readyByBattletag: g.officer.battletag,
          bettorSourceFetchedAt: g.bettorSourceFetchedAt,
          candidateSourceFetchedAt: g.candidateSourceFetchedAt,
        },
      });
      if (pronta.count !== 1) {
        throw new Error(`a rodada ${g.roundId} já teve Ready`);
      }
    });
  }

  async registrarEvento(e: {
    roundId: string;
    type: BetEventType;
    actor: { userId: string; battletag: string };
    payload: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.betEvent.create({
      data: {
        roundId: e.roundId,
        type: e.type,
        actorUserId: e.actor.userId,
        actorBattletag: e.actor.battletag,
        payload: e.payload,
      },
    });
  }

  /**
   * Personagens da conta que estão no snapshot de bettors da rodada, do melhor
   * rank para o pior. A ligação conta ↔ personagem é o `GuildCharacter` de
   * agora (D-38): um login feito depois do Ready associa, mas não muda o
   * snapshot.
   */
  personagensDaContaNoSnapshot(
    roundId: string,
    userId: string,
  ): Promise<Array<{ characterId: string; rank: number }>> {
    return this.prisma.betRoundBettor.findMany({
      where: { roundId, character: { guildCharacter: { userId } } },
      select: { characterId: true, rank: true },
      orderBy: [{ rank: 'asc' }, { characterId: 'asc' }],
    });
  }

  /** O personagem é da conta (`GuildCharacter` de agora)? — D-02. */
  async personagemEDaConta(userId: string, characterId: string): Promise<boolean> {
    const achado = await this.prisma.guildCharacter.findFirst({
      where: { userId, characterId },
      select: { id: true },
    });
    return achado !== null;
  }

  /** O que a rodada oferece para apostar: mercados, encounters e o snapshot de candidatos. */
  async cardapio(roundId: string): Promise<Cardapio> {
    const [markets, encounters, candidatos] = await Promise.all([
      this.prisma.betMarket.findMany({
        where: { roundId },
        select: { id: true, kind: true },
      }),
      this.prisma.betRoundEncounter.findMany({
        where: { roundId },
        select: { id: true, inWeeklyProgression: true },
      }),
      this.prisma.betRoundCandidate.findMany({
        where: { roundId },
        select: { characterId: true, role: true },
      }),
    ]);
    return { markets, encounters, candidatos };
  }

  /**
   * "Salvar" (D-27): substitui as apostas do rascunho ativo da conta, criando o
   * slip se ainda não houver um ativo. O slip ativo fica travado (`FOR UPDATE`)
   * durante a transação — Salvar e Submeter da mesma conta não se cruzam.
   */
  async salvarRascunho(r: {
    roundId: string;
    owner: { userId: string; battletag: string };
    eligibilityCharacterId: string;
    apostas: ApostaParaGravar[];
  }): Promise<{ tipo: 'ok'; slipId: string } | { tipo: 'nao_editavel'; status: BetSlipStatus }> {
    return this.prisma.$transaction(async (tx) => {
      const [ativo] = await tx.$queryRaw<Array<{ id: string; status: BetSlipStatus }>>`
        SELECT "id", "status" FROM "BetSlip"
        WHERE "roundId" = ${r.roundId} AND "ownerUserId" = ${r.owner.userId}
          AND "status" IN ('rascunho', 'aguardando_deposito', 'valido')
        FOR UPDATE`;

      if (ativo && ativo.status !== 'rascunho') {
        return { tipo: 'nao_editavel' as const, status: ativo.status };
      }

      const slipId =
        ativo?.id ??
        (
          await tx.betSlip.create({
            data: {
              roundId: r.roundId,
              ownerUserId: r.owner.userId,
              ownerBattletag: r.owner.battletag,
              eligibilityCharacterId: r.eligibilityCharacterId,
            },
            select: { id: true },
          })
        ).id;

      const anteriores = await tx.bet.findMany({ where: { slipId }, select: { id: true } });
      await tx.betWeeklySelection.deleteMany({
        where: { betId: { in: anteriores.map((b) => b.id) } },
      });
      await tx.bet.deleteMany({ where: { slipId } });

      for (const a of r.apostas) {
        const aposta = await tx.bet.create({
          data: {
            slipId,
            roundId: r.roundId,
            marketId: a.marketId,
            marketKind: a.marketKind,
            stake: a.stake,
            targetCharacterId: a.alvo?.characterId ?? null,
            targetRole: a.alvo?.role ?? null,
          },
          select: { id: true },
        });
        if (a.encounterIds.length > 0) {
          await tx.betWeeklySelection.createMany({
            data: a.encounterIds.map((roundEncounterId) => ({
              betId: aposta.id,
              roundId: r.roundId,
              marketKind: a.marketKind,
              roundEncounterId,
              inWeeklyProgression: true,
            })),
          });
        }
      }

      return { tipo: 'ok' as const, slipId };
    });
  }

  /**
   * "Submeter pagamento" (D-27): congela o rascunho ativo da conta. A regra de
   * negócio (o que pode ser submetido e o total) vem do service e é avaliada
   * aqui dentro, com o slip travado — as apostas lidas são exatamente as que
   * ficam congeladas.
   */
  async submeterRascunho(r: {
    roundId: string;
    userId: string;
    depositCharacterId: string;
    agora: Date;
    avaliar: (apostas: ApostaGravada[]) => { total: number } | { recusa: string };
  }): Promise<
    | { tipo: 'ok'; slipId: string; total: number }
    | { tipo: 'sem_rascunho' }
    | { tipo: 'recusado'; motivo: string }
  > {
    return this.prisma.$transaction(async (tx) => {
      const [rascunho] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "BetSlip"
        WHERE "roundId" = ${r.roundId} AND "ownerUserId" = ${r.userId} AND "status" = 'rascunho'
        FOR UPDATE`;
      if (!rascunho) return { tipo: 'sem_rascunho' as const };

      const apostas = await tx.bet.findMany({
        where: { slipId: rascunho.id },
        select: { marketKind: true, stake: true, targetCharacterId: true },
      });
      const avaliacao = r.avaliar(apostas);
      if ('recusa' in avaliacao) return { tipo: 'recusado' as const, motivo: avaliacao.recusa };

      await tx.betSlip.update({
        where: { id: rascunho.id },
        data: {
          status: 'aguardando_deposito',
          submittedAt: r.agora,
          expectedTotal: avaliacao.total,
          depositCharacterId: r.depositCharacterId,
        },
      });
      return { tipo: 'ok' as const, slipId: rascunho.id, total: avaliacao.total };
    });
  }

  /**
   * Confirmação do depósito (R-15): `valido` e o lançamento `deposito_validado`
   * na mesma transação (§16.6). O slip travado serializa confirmações.
   */
  async confirmarDeposito(r: {
    slipId: string;
    officer: { userId: string; battletag: string };
    agora: Date;
  }): Promise<{ tipo: 'ok' } | { tipo: 'nao_pendente'; status: BetSlipStatus | null }> {
    return this.prisma.$transaction(async (tx) => {
      const slip = await this.travarSlip(tx, r.slipId);
      if (slip?.status !== 'aguardando_deposito') {
        return { tipo: 'nao_pendente' as const, status: slip?.status ?? null };
      }

      await tx.betSlip.update({
        where: { id: r.slipId },
        data: {
          status: 'valido',
          validatedAt: r.agora,
          validatedByUserId: r.officer.userId,
          validatedByBattletag: r.officer.battletag,
        },
      });
      await tx.goldLedgerEntry.create({
        data: {
          roundId: slip.roundId,
          account: 'membro',
          slipId: r.slipId,
          kind: 'deposito_validado',
          amount: slip.expectedTotal!,
          actorUserId: r.officer.userId,
          actorBattletag: r.officer.battletag,
        },
      });
      return { tipo: 'ok' as const };
    });
  }

  /** Recusa do depósito (D-34): terminal, com officer e motivo; sem lançamento. */
  async recusarDeposito(r: {
    slipId: string;
    officer: { userId: string; battletag: string };
    motivo: string;
    agora: Date;
  }): Promise<{ tipo: 'ok' } | { tipo: 'nao_pendente'; status: BetSlipStatus | null }> {
    return this.prisma.$transaction(async (tx) => {
      const slip = await this.travarSlip(tx, r.slipId);
      if (slip?.status !== 'aguardando_deposito') {
        return { tipo: 'nao_pendente' as const, status: slip?.status ?? null };
      }

      await tx.betSlip.update({
        where: { id: r.slipId },
        data: {
          status: 'recusado',
          rejectedAt: r.agora,
          rejectedByUserId: r.officer.userId,
          rejectedByBattletag: r.officer.battletag,
          rejectionReason: r.motivo,
        },
      });
      return { tipo: 'ok' as const };
    });
  }

  /**
   * O que o cutoff faz com o que não foi confirmado (D-07, D-35): rascunho e
   * pendente de rodada vencida viram `expirado`. Idempotente.
   */
  async expirarVencidos(agora: Date): Promise<number> {
    const { count } = await this.prisma.betSlip.updateMany({
      where: {
        status: { in: ['rascunho', 'aguardando_deposito'] },
        round: { cutoffAt: { lte: agora } },
      },
      data: { status: 'expirado', expiredAt: agora },
    });
    return count;
  }

  /**
   * Os slips da conta na rodada, do mais novo para o mais antigo (D-21, D-36).
   *
   * O filtro por dono vive aqui, e não no controller (§9.1): não existe leitura
   * de slip por id no lado do membro, então não há id de outra pessoa a pedir.
   */
  async slipsDaConta(roundId: string, ownerUserId: string) {
    return this.prisma.betSlip.findMany({
      where: { roundId, ownerUserId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        depositCharacterId: true,
        expectedTotal: true,
        rejectionReason: true,
        bets: {
          orderBy: { createdAt: 'asc' },
          select: {
            marketId: true,
            marketKind: true,
            stake: true,
            targetCharacterId: true,
            weeklySelections: { select: { roundEncounterId: true } },
          },
        },
      },
    });
  }

  /**
   * Depósitos pendentes da rodada, para o Officer Panel (§16.9): só `BetSlip` e
   * o nome do depositante — nenhum join em `Bet`. A escolha não é necessária
   * para conferir o Guild Bank, e o que não é lido não vaza.
   */
  async depositosPendentes(roundId: string) {
    return this.prisma.betSlip.findMany({
      where: { roundId, status: 'aguardando_deposito' },
      orderBy: { submittedAt: 'asc' },
      select: {
        id: true,
        ownerBattletag: true,
        expectedTotal: true,
        submittedAt: true,
        depositCharacter: { select: { name: true, realm: true } },
      },
    });
  }

  /**
   * Σ stake por opção dos mercados de escolha simples, só de slips `valido`
   * (D-12). Agregado no banco (§16.10): nenhuma aposta individual sai daqui.
   */
  async somasValidasPorOpcao(
    roundId: string,
  ): Promise<Array<{ marketId: string; characterId: string; soma: number }>> {
    const grupos = await this.prisma.bet.groupBy({
      by: ['marketId', 'targetCharacterId'],
      where: { roundId, targetCharacterId: { not: null }, slip: { status: 'valido' } },
      _sum: { stake: true },
    });
    return grupos.map((g) => ({
      marketId: g.marketId,
      characterId: g.targetCharacterId!,
      soma: g._sum.stake ?? 0,
    }));
  }

  /** O que o Auditar precisa da rodada: o relógio, o Ready e a tentativa corrente. */
  async rodadaParaAuditar(roundId: string) {
    const rodada = await this.prisma.betRound.findUnique({
      where: { id: roundId },
      select: {
        cutoffAt: true,
        readyAt: true,
        audits: {
          where: { status: { not: 'substituida' } },
          orderBy: { attempt: 'desc' },
          take: 1,
          select: { status: true },
        },
      },
    });
    if (!rodada) return null;
    const [corrente] = rodada.audits;
    return {
      cutoffAt: rodada.cutoffAt,
      readyAt: rodada.readyAt,
      auditoria: (corrente?.status ?? null) as Exclude<BetAuditStatus, 'substituida'> | null,
    };
  }

  /**
   * Uma tentativa nova de Auditar (D-30), com as fontes das duas sessões, numa
   * transação. As tentativas abertas anteriores viram `substituida`, apontando
   * esta — intactas, porque o banco não deixa mudar mais nada nelas (T-A09).
   */
  async gravarAuditoria(g: {
    roundId: string;
    officer: { userId: string; battletag: string };
    status: 'aguardando_revisao' | 'pronta';
    fontes: FonteParaGravar[];
  }): Promise<{ auditId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const ultima = await tx.betAudit.aggregate({
        where: { roundId: g.roundId },
        _max: { attempt: true },
      });
      const nova = await tx.betAudit.create({
        data: {
          roundId: g.roundId,
          attempt: (ultima._max.attempt ?? 0) + 1,
          status: g.status,
          startedByUserId: g.officer.userId,
          startedByBattletag: g.officer.battletag,
        },
        select: { id: true },
      });
      for (const f of g.fontes) {
        await tx.betAuditSource.create({
          data: {
            auditId: nova.id,
            session: f.session,
            resolution: f.resolution,
            ...referenciaDoReport(f.report),
            candidates: f.candidatos as unknown as Prisma.InputJsonValue,
          },
        });
      }
      await tx.betAudit.updateMany({
        where: {
          roundId: g.roundId,
          id: { not: nova.id },
          status: { in: ['aguardando_revisao', 'pronta', 'calculada'] },
        },
        data: { status: 'substituida', supersededByAuditId: nova.id },
      });
      return { auditId: nova.id };
    });
  }

  /**
   * A escolha do officer numa sessão ambígua (D-25). A auditoria fica travada
   * (`FOR UPDATE`) durante a transação; quem decide se a escolha vale é o
   * service, com a fonte gravada — nunca uma leitura nova do WCL (T-A12).
   * Resolvida a última pendência, a auditoria fica `pronta`.
   */
  async escolherFonte(r: {
    auditId: string;
    session: BetAuditSession;
    officer: { userId: string; battletag: string };
    agora: Date;
    escolher: (fonte: {
      resolution: BetSourceResolution;
      candidatos: ReportGravado[];
    }) => { report: ReportGravado } | { recusa: string };
  }): Promise<{ tipo: 'ok' } | { tipo: 'recusado'; motivo: string }> {
    return this.prisma.$transaction(async (tx) => {
      const [auditoria] = await tx.$queryRaw<Array<{ status: BetAuditStatus }>>`
        SELECT "status" FROM "BetAudit" WHERE "id" = ${r.auditId} FOR UPDATE`;
      if (!auditoria) return { tipo: 'recusado' as const, motivo: 'a auditoria não existe' };
      if (auditoria.status !== 'aguardando_revisao') {
        return {
          tipo: 'recusado' as const,
          motivo: `a auditoria está ${auditoria.status} — só se escolhe fonte em revisão`,
        };
      }

      const fontes = await tx.betAuditSource.findMany({
        where: { auditId: r.auditId },
        select: { id: true, session: true, resolution: true, candidates: true },
      });
      const fonte = fontes.find((f) => f.session === r.session);
      if (!fonte) return { tipo: 'recusado' as const, motivo: 'a sessão não tem fonte' };

      const decisao = r.escolher({
        resolution: fonte.resolution,
        candidatos: fonte.candidates as unknown as ReportGravado[],
      });
      if ('recusa' in decisao) return { tipo: 'recusado' as const, motivo: decisao.recusa };

      await tx.betAuditSource.update({
        where: { id: fonte.id },
        data: {
          resolution: 'escolha_officer',
          ...referenciaDoReport(decisao.report),
          resolvedByUserId: r.officer.userId,
          resolvedByBattletag: r.officer.battletag,
          resolvedAt: r.agora,
        },
      });

      const pendentes = fontes.filter(
        (f) => f.id !== fonte.id && !['automatica', 'escolha_officer'].includes(f.resolution),
      );
      if (pendentes.length === 0) {
        await tx.betAudit.update({ where: { id: r.auditId }, data: { status: 'pronta' } });
      }
      return { tipo: 'ok' as const };
    });
  }

  /** A tentativa corrente da rodada, com as fontes — o que o Officer Panel mostra. */
  auditoriaCorrente(roundId: string) {
    return this.prisma.betAudit.findFirst({
      where: { roundId, status: { not: 'substituida' } },
      orderBy: { attempt: 'desc' },
      select: {
        id: true,
        attempt: true,
        status: true,
        startedByBattletag: true,
        startedAt: true,
        sources: {
          orderBy: { session: 'asc' },
          select: {
            session: true,
            resolution: true,
            reportCode: true,
            reportTitle: true,
            reportRevision: true,
            reportStartTime: true,
            candidates: true,
            resolvedByBattletag: true,
            resolvedAt: true,
          },
        },
      },
    });
  }

  /**
   * Cria a rodada em PREPARATION, sem encounter nem mercado (D-45). `null`
   * quando o period já tem rodada — o unique `period` decide, não uma leitura
   * antes.
   */
  async criarRodada(r: {
    period: number;
    seasonId: number | null;
    opensAt: Date;
    cutoffAt: Date;
    officer: { userId: string; battletag: string };
  }): Promise<{ roundId: string } | null> {
    const { officer, ...dados } = r;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rodada = await tx.betRound.create({ data: dados, select: { id: true } });
        // A rodada não tem coluna de autor; quem criou fica no evento (D-11).
        await tx.betEvent.create({
          data: {
            roundId: rodada.id,
            type: 'rodada_criada',
            actorUserId: officer.userId,
            actorBattletag: officer.battletag,
            payload: { period: dados.period },
          },
        });
        return { roundId: rodada.id };
      });
    } catch (erro: unknown) {
      if ((erro as { code?: string }).code === 'P2002') return null;
      throw erro;
    }
  }

  /** A rodada com a configuração preparada, para a preparação e para a vista do officer. */
  rodadaEmPreparacao(roundId: string) {
    return this.prisma.betRound.findUnique({
      where: { id: roundId },
      select: {
        id: true,
        period: true,
        opensAt: true,
        cutoffAt: true,
        readyAt: true,
        encounters: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            encounterId: true,
            encounterName: true,
            zoneName: true,
            track: true,
            inWeeklyProgression: true,
            markets: { orderBy: { createdAt: 'asc' }, select: { id: true, kind: true } },
          },
        },
        markets: {
          where: { kind: 'weekly_progression' },
          select: { id: true },
        },
      },
    });
  }

  /**
   * Aplica o plano de preparação numa transação (D-45), com o `BetEvent` do que
   * mudou. A ordem importa: mercados saem antes de o encounter mudar de track —
   * a FK composta propaga o track para eles, e o CHECK de progressão recusaria
   * um Top DPS num boss que virou progressão.
   */
  async aplicarPreparacao(p: PlanoDePreparacao): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (p.removerMercados.length > 0) {
        await tx.betMarket.deleteMany({ where: { id: { in: p.removerMercados } } });
      }
      if (p.removerEncounters.length > 0) {
        await tx.betRoundEncounter.deleteMany({ where: { id: { in: p.removerEncounters } } });
      }
      for (const e of p.alterarEncounters) {
        await tx.betRoundEncounter.update({
          where: { id: e.id },
          data: {
            track: e.track,
            inWeeklyProgression: e.inWeeklyProgression,
            updatedByUserId: p.officer.userId,
            updatedByBattletag: p.officer.battletag,
          },
        });
      }
      const idPorEncounter = new Map(p.encountersExistentes);
      for (const e of p.criarEncounters) {
        const criado = await tx.betRoundEncounter.create({
          data: {
            roundId: p.roundId,
            encounterId: e.encounterId,
            encounterName: e.encounterName,
            zoneName: e.zoneName,
            track: e.track,
            inWeeklyProgression: e.inWeeklyProgression,
            createdByUserId: p.officer.userId,
            createdByBattletag: p.officer.battletag,
          },
          select: { id: true },
        });
        idPorEncounter.set(e.encounterId, criado.id);
      }
      for (const m of p.criarMercados) {
        await tx.betMarket.create({
          data: {
            roundId: p.roundId,
            kind: m.kind,
            roundEncounterId: m.encounterId === null ? null : idPorEncounter.get(m.encounterId)!,
            track: m.track,
            createdByUserId: p.officer.userId,
            createdByBattletag: p.officer.battletag,
          },
        });
      }
      if (p.evento) {
        await tx.betEvent.create({
          data: {
            roundId: p.roundId,
            type: 'configuracao_salva',
            actorUserId: p.officer.userId,
            actorBattletag: p.officer.battletag,
            payload: p.evento,
          },
        });
      }
    });
  }

  private async travarSlip(tx: Prisma.TransactionClient, slipId: string) {
    const [slip] = await tx.$queryRaw<
      Array<{ roundId: string; status: BetSlipStatus; expectedTotal: number | null }>
    >`SELECT "roundId", "status", "expectedTotal" FROM "BetSlip" WHERE "id" = ${slipId} FOR UPDATE`;
    return slip;
  }
}

/** O cardápio de uma rodada. */
export interface Cardapio {
  markets: Array<{ id: string; kind: BetMarketKind }>;
  encounters: Array<{ id: string; inWeeklyProgression: boolean }>;
  candidatos: Array<{ characterId: string; role: BetCandidateRole }>;
}

/** Uma aposta já validada pelo service, pronta para gravar. */
export interface ApostaParaGravar {
  marketId: string;
  marketKind: BetMarketKind;
  stake: number;
  alvo: { characterId: string; role: BetCandidateRole } | null;
  encounterIds: string[];
}

/** Uma aposta como está gravada — o que o "Submeter pagamento" avalia. */
export interface ApostaGravada {
  marketKind: BetMarketKind;
  stake: number;
  targetCharacterId: string | null;
}

/**
 * Um report como ficou gravado na evidência do Auditar: `startTime` em epoch
 * ms, como o WCL responde. É a referência congelada (§15.10).
 */
export interface ReportGravado {
  code: string;
  title: string;
  revision: number;
  startTime: number;
}

/** A fonte de uma sessão, pronta para gravar. */
export interface FonteParaGravar {
  session: BetAuditSession;
  resolution: 'automatica' | 'ausente' | 'ambigua';
  report: ReportGravado | null;
  candidatos: ReportGravado[];
}

/** As colunas da referência do report — todas, ou nenhuma (CHECK do banco). */
function referenciaDoReport(report: ReportGravado | null) {
  return {
    reportCode: report?.code ?? null,
    reportTitle: report?.title ?? null,
    reportRevision: report?.revision ?? null,
    reportStartTime: report ? new Date(report.startTime) : null,
  };
}

/** O que a preparação da semana muda, já decidido pelo service (D-45). */
export interface PlanoDePreparacao {
  roundId: string;
  officer: { userId: string; battletag: string };
  removerMercados: string[];
  removerEncounters: string[];
  alterarEncounters: Array<{
    id: string;
    track: BetEncounterTrack;
    inWeeklyProgression: boolean;
  }>;
  /** encounterId do WCL → id do `BetRoundEncounter`, dos que ficam. */
  encountersExistentes: Array<[number, string]>;
  criarEncounters: Array<{
    encounterId: number;
    encounterName: string;
    zoneName: string;
    track: BetEncounterTrack;
    inWeeklyProgression: boolean;
  }>;
  /** `encounterId` nulo = a Weekly. */
  criarMercados: Array<{
    encounterId: number | null;
    kind: BetMarketKind;
    track: BetEncounterTrack | null;
  }>;
  /** O `BetEvent` do salvamento; nulo quando nada mudou. */
  evento: Prisma.InputJsonObject | null;
}
