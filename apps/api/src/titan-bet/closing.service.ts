import { Injectable } from '@nestjs/common';
import type { GoldLedgerKind } from '@prisma/client';
import { closingReportSchema, type ClosingPublicado, type ClosingReport } from '@titan/shared';
import { ClosingRepository } from './closing.repository';
import { motivoDaEvidencia } from './resultados';

/** A publicação foi recusada; nada foi publicado. */
export class ClosingRecusado extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'ClosingRecusado';
  }
}

interface Officer {
  userId: string;
  battletag: string;
}

/** O que a conta do membro recebeu na rodada (§16.6): o total devido agregado. */
const CREDITOS: ReadonlySet<GoldLedgerKind> = new Set([
  'premio',
  'restituicao_anulado',
  'restituicao_expirado',
  'ajuste',
]);

/**
 * O Round Closing Report (D-21, D-48; §8.5, §16.7): o documento publicado da
 * rodada, gerado **só** do resultado confirmado e do ledger. O membro aparece
 * pelo personagem de elegibilidade da aposta, nunca pelo BattleTag.
 *
 * Validado pelo schema publicado antes de gravar — um campo a mais quebra aqui,
 * não na tela. Republicar é versão nova; nenhuma muda depois.
 */
@Injectable()
export class ClosingService {
  constructor(private readonly repo: ClosingRepository) {}

  async publicar(roundId: string, officer: Officer): Promise<{ version: number }> {
    const rodada = await this.repo.rodadaConfirmada(roundId);
    if (!rodada) throw new ClosingRecusado(`a rodada ${roundId} não existe`);
    const [auditoria] = rodada.audits;
    if (!auditoria) {
      throw new ClosingRecusado('a rodada não tem auditoria confirmada — não há o que publicar');
    }

    const lancamentos = await this.repo.lancamentosDaRodada(roundId);
    const conteudo = closingReportSchema.parse(montar(rodada, auditoria, lancamentos));

    try {
      return await this.repo.publicar({
        roundId,
        auditId: auditoria.id,
        ledgerThroughEntryId: lancamentos[lancamentos.length - 1]?.id ?? 0n,
        content: conteudo,
        officer,
      });
    } catch (erro: unknown) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      throw new ClosingRecusado(`o relatório não foi publicado: ${motivo}`);
    }
  }

  /** A última versão publicada, para os membros; `null` antes da primeira. */
  async ultimo(roundId: string): Promise<ClosingPublicado | null> {
    const doc = await this.repo.ultimo(roundId);
    if (!doc) return null;
    return {
      version: doc.version,
      publishedAt: doc.publishedAt.toISOString(),
      conteudo: closingReportSchema.parse(doc.content),
    };
  }
}

type Rodada = NonNullable<Awaited<ReturnType<ClosingRepository['rodadaConfirmada']>>>;
type Lancamento = Awaited<ReturnType<ClosingRepository['lancamentosDaRodada']>>[number];

function montar(
  rodada: Rodada,
  auditoria: Rodada['audits'][number],
  lancamentos: Lancamento[],
): ClosingReport {
  const membro = (l: Lancamento) => l.slip!.eligibility;
  const chave = (m: { name: string; realm: string }) => `${m.realm}/${m.name}`;

  const mercados = auditoria.results.map((r) => {
    const ganhos = new Map<string, { membro: { name: string; realm: string }; valor: number }>();
    for (const l of lancamentos) {
      if (l.kind !== 'premio' || l.marketId !== r.marketId) continue;
      const m = membro(l);
      const atual = ganhos.get(chave(m));
      ganhos.set(chave(m), { membro: m, valor: (atual?.valor ?? 0) + l.amount });
    }
    return {
      marketId: r.marketId,
      kind: r.market.kind,
      encounterName: r.market.roundEncounter?.encounterName ?? null,
      desfecho: r.outcome,
      motivo: r.voidReason ?? motivoDaEvidencia(r.evidence),
      vencedores: r.winners.map((w) => w.candidate),
      bossesVencedores: r.kills.map((k) => k.roundEncounter.encounterName),
      ganhos: [...ganhos.values()],
    };
  });

  const soma = (kind: GoldLedgerKind) =>
    lancamentos.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0);

  const totais = new Map<string, { membro: { name: string; realm: string }; devido: number }>();
  for (const l of lancamentos) {
    if (!CREDITOS.has(l.kind) || !l.slip) continue;
    const m = membro(l);
    const atual = totais.get(chave(m));
    totais.set(chave(m), { membro: m, devido: (atual?.devido ?? 0) + l.amount });
  }

  return {
    versao: 1,
    roundId: rodada.id,
    period: rodada.period,
    mercados,
    guildBank: { receita: soma('receita_guilda'), residuo: soma('residuo_guilda') },
    totais: [...totais.values()].filter((t) => t.devido !== 0),
  };
}
