import { Injectable } from '@nestjs/common';
import type {
  FaseDaRodada,
  RodadaDoMembro,
  RodadasDoMembro,
  RodadasDoOfficer,
} from '@titan/shared';
import { ElegibilidadeService } from './elegibilidade.service';
import { faseDaRodada, type StatusDaAuditoria } from './fases';
import { TitanBetRepository } from './titan-bet.repository';

type RodadaComEstado = Awaited<ReturnType<TitanBetRepository['rodadasComEstado']>>[number];

/**
 * A rodada como o front a lê (titan-bet-test-design.md §34.1): achar a rodada
 * e ler o cardápio com nomes. Só leitura; nenhuma aposta sai daqui.
 */
@Injectable()
export class RodadasService {
  constructor(
    private readonly repo: TitanBetRepository,
    private readonly elegibilidade: ElegibilidadeService,
  ) {}

  /**
   * T-C01: membro vê as rodadas publicadas (com Ready) — o Closing é da guilda
   * (D-21). Quem saiu da guilda vê só as rodadas em que tem slip (D-53a).
   */
  async visiveis(userId: string, membro: boolean): Promise<RodadasDoMembro> {
    const rodadas = await this.repo.rodadasComEstado(
      membro ? { publicadas: true } : { publicadas: true, comSlipDe: userId },
    );
    const agora = new Date();
    return { rodadas: rodadas.map((r) => resumo(r, agora)) };
  }

  /**
   * T-C02: o cardápio com nomes. `null` quando a rodada não existe ou ainda
   * não teve Ready — preparação não é publicada (D-36, D-45).
   */
  async daRodada(roundId: string, userId: string): Promise<RodadaDoMembro | null> {
    const r = await this.repo.cardapioLegivel(roundId);
    if (!r || r.readyAt === null) return null;

    const agora = new Date();
    const [elegibilidade, ligados] = await Promise.all([
      this.elegibilidade.personagemDeElegibilidade(roundId, userId),
      this.repo.personagensDaConta(userId),
    ]);
    const base = resumo(r, agora);

    return {
      ...base,
      mercados: r.markets.map((m): RodadaDoMembro['mercados'][number] =>
        m.kind === 'weekly_progression'
          ? { marketId: m.id, kind: 'weekly_progression', boss: null }
          : {
              marketId: m.id,
              kind: m.kind,
              // Mercado de boss sempre tem encounter — FK composta e CHECK (§16.4).
              boss: {
                roundEncounterId: m.roundEncounter!.id,
                encounterName: m.roundEncounter!.encounterName,
                track: m.roundEncounter!.track,
              },
            },
      ),
      bossesDeProgressao: r.encounters.map((e) => ({
        roundEncounterId: e.id,
        encounterName: e.encounterName,
      })),
      candidatos: r.candidates.map((c) => ({
        characterId: c.characterId,
        name: c.character.name,
        realm: c.character.realm,
        role: c.role,
      })),
      // A mesma regra do Salvar (D-38, D-53b), antecipada para a tela.
      podeApostar: base.fase === 'OPEN' && elegibilidade !== null,
      // Os que o First Death recusa já no Salvar (D-56).
      personagensDoApostador: [...new Set([...ligados, ...(elegibilidade ? [elegibilidade] : [])])],
    };
  }

  /** T-C04: todas as rodadas, inclusive em preparação, para o Officer Panel. */
  async doOfficer(): Promise<RodadasDoOfficer> {
    const rodadas = await this.repo.rodadasComEstado();
    const agora = new Date();
    return {
      rodadas: rodadas.map((r) => ({
        ...resumo(r, agora),
        readyAt: r.readyAt?.toISOString() ?? null,
        readyByBattletag: r.readyByBattletag,
      })),
    };
  }
}

function resumo(r: RodadaComEstado, agora: Date) {
  return {
    roundId: r.id,
    period: r.period,
    opensAt: r.opensAt.toISOString(),
    cutoffAt: r.cutoffAt.toISOString(),
    fase: fase(r, agora),
  };
}

function fase(r: RodadaComEstado, agora: Date): FaseDaRodada {
  return faseDaRodada(
    {
      readyAt: r.readyAt,
      cutoffAt: r.cutoffAt,
      auditoria: (r.audits[0]?.status as StatusDaAuditoria | undefined) ?? null,
      temClosingReport: r._count.closingReports > 0,
    },
    agora,
  );
}
