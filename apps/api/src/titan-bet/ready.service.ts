import { Injectable, Logger } from '@nestjs/common';
import type { BetCandidateRole } from '@prisma/client';
import { BlizzardService } from '../blizzard/blizzard.service';
import {
  chaveDe,
  CharactersRepository,
  indice,
  type PersonagemDaFonte,
} from '../characters/characters.repository';
import { WowAuditService } from '../wowaudit/wowaudit.service';
import { podeDarReady } from './fases';
import { TitanBetRepository } from './titan-bet.repository';

/** O Ready foi recusado; a rodada continua em PREPARATION, sem nada gravado. */
export class ReadyRecusado extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'ReadyRecusado';
  }
}

/** As roles que o Titan Roster pode ter — as mesmas do enum do banco. */
const ROLES: readonly BetCandidateRole[] = ['Tank', 'Melee', 'Heal', 'Ranged'];

/**
 * O Ready do Titan Bet: o configuration freeze da rodada (D-31).
 *
 * Atômico. Primeiro lê e confere as fontes — roster da Blizzard e Titan Roster
 * do WoWAudit, os dois **frescos** e não vazios —; só então grava, numa
 * transação, os snapshots de bettors (D-32, D-38) e de candidatos (D-33) junto
 * com o `readyAt`. Qualquer falha deixa a rodada em PREPARATION e fica
 * registrada no `BetEvent`, o único rastro de um Ready que não aconteceu
 * (§16.8).
 *
 * Sem dia fixo: vale a qualquer momento antes do cutoff.
 */
@Injectable()
export class ReadyService {
  private readonly logger = new Logger(ReadyService.name);

  constructor(
    private readonly repo: TitanBetRepository,
    private readonly characters: CharactersRepository,
    private readonly blizzard: BlizzardService,
    private readonly wowaudit: WowAuditService,
  ) {}

  async ready(roundId: string, officer: { userId: string; battletag: string }): Promise<void> {
    const rodada = await this.repo.rodadaParaReady(roundId);
    if (!rodada) throw new ReadyRecusado(`a rodada ${roundId} não existe`);

    try {
      await this.congelar(rodada, officer);
    } catch (erro: unknown) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      await this.repo.registrarEvento({
        roundId,
        type: 'ready_falhou',
        actor: officer,
        payload: { motivo },
      });
      this.logger.warn(`Ready da rodada ${roundId} recusado: ${motivo}`);
      throw erro instanceof ReadyRecusado ? erro : new ReadyRecusado(motivo);
    }
  }

  private async congelar(
    rodada: NonNullable<Awaited<ReturnType<TitanBetRepository['rodadaParaReady']>>>,
    officer: { userId: string; battletag: string },
  ): Promise<void> {
    const agora = new Date();
    const estado = {
      ...rodada,
      auditoria: null,
      temClosingReport: false,
      canceladaEm: rodada.cancelledAt,
    };
    if (!podeDarReady(estado, agora)) {
      throw new ReadyRecusado(
        rodada.cancelledAt
          ? 'a rodada foi cancelada (D-77)'
          : rodada.readyAt
            ? 'a rodada já teve Ready'
            : 'o cutoff da rodada já passou',
      );
    }

    const temWeekly = rodada.markets.some((m) => m.kind === 'weekly_progression');
    // As opções da Weekly são os bosses de progressão (D-54).
    if (temWeekly && !rodada.encounters.some((e) => e.track === 'progressao')) {
      throw new ReadyRecusado('a Weekly Progression não tem nenhum boss de progressão');
    }

    // Frescas, sempre: o que o Ready grava vale a semana inteira.
    const [roster, time] = await Promise.all([
      this.blizzard.getGuildRosterSnapshot(true),
      this.wowaudit.getTeamCharactersSnapshot(true),
    ]);

    if (roster.stale) throw new ReadyRecusado('o roster da Blizzard veio do cache velho');
    if (time.stale) throw new ReadyRecusado('o Titan Roster (WoWAudit) veio do cache velho');
    if (roster.members.length === 0) throw new ReadyRecusado('o roster da guilda veio vazio');
    if (time.characters.length === 0) throw new ReadyRecusado('o Titan Roster veio vazio');

    const semRole = time.characters.filter((c) => !ROLES.includes(c.role as BetCandidateRole));
    if (semRole.length > 0) {
      const lista = semRole.map((c) => `${c.name}-${c.realm} (${c.role})`).join(', ');
      throw new ReadyRecusado(`role desconhecida no Titan Roster: ${lista}`);
    }

    // O roster da Blizzard só traz o slug do realm; é o que a identidade usa
    // para personagem vindo dele (precedente: OfficersService).
    const daGuilda: PersonagemDaFonte[] = roster.members.map((m) => ({
      name: m.name,
      realm: m.realmSlug,
    }));
    const doTime: PersonagemDaFonte[] = time.characters.map((c) => ({
      name: c.name,
      realm: c.realm,
    }));
    const ids = await this.characters.resolverVarios([...daGuilda, ...doTime]);
    const idDe = (p: PersonagemDaFonte): string => {
      const id = ids.get(indice(chaveDe(p)));
      if (!id) throw new ReadyRecusado(`identidade não resolvida para ${p.name}-${p.realm}`);
      return id;
    };

    await this.repo.gravarReady({
      roundId: rodada.id,
      officer,
      readyAt: agora,
      bettors: roster.members.map((m, i) => ({
        characterId: idDe(daGuilda[i]!),
        rank: m.rank,
        name: m.name,
        realm: m.realmSlug,
      })),
      candidatos: time.characters.map((c, i) => ({
        characterId: idDe(doTime[i]!),
        role: c.role as BetCandidateRole,
        name: c.name,
        realm: c.realm,
      })),
      bettorSourceFetchedAt: new Date(roster.fetchedAt),
      candidateSourceFetchedAt: new Date(time.fetchedAt),
    });

    this.logger.log(
      `Ready da rodada ${rodada.id} por ${officer.battletag}: ` +
        `${roster.members.length} bettors, ${time.characters.length} candidatos`,
    );
  }
}
