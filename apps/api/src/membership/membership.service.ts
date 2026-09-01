import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BlizzardService, type RosterMember } from '../blizzard/blizzard.service';
import { chaveDe, indice } from '../characters/characters.repository';
import { MembershipRepository } from './membership.repository';

/**
 * Resultado de uma rodada. Existe como valor de retorno (e não só como log)
 * para o teste poder afirmar "não revogou ninguém" sem inspecionar log.
 */
export type RevalidationResult =
  | { status: 'aborted'; reason: string }
  | {
      status: 'ok';
      checked: number;
      revoked: number;
      sessionsDeleted: number;
      ranksUpdated: number;
      /** Personagens que saíram da guilda sem a conta perder acesso. */
      charactersRemoved: number;
      unverifiable: number;
    };

/**
 * Revalidação periódica de membership.
 *
 * A membership é confirmada no login, e desde a TIT-148 a sessão dura uma
 * semana deslizante — ou seja, quem usa o site toda semana nunca reloga. Sem
 * esta rodada, quem sai da guilda continuaria vendo a área interna até isso
 * vencer, e quem não deslogasse continuaria para sempre.
 *
 * **Isto é o que substituiu o TTL curto de sessão**, e é o que permitiu alongá-lo:
 * revogar deixou de depender de a sessão expirar sozinha. `revokeMembership`
 * apaga as sessões junto, então o acesso cai na rodada, não no vencimento.
 *
 * Não precisa de token do usuário: os personagens gravados no login permitem
 * conferir contra o roster com a credencial da própria aplicação. É por isso que
 * não guardamos refresh token de ninguém.
 *
 * LIMITE CONHECIDO: esta rodada nunca **descobre** personagem novo, porque o
 * roster da Blizzard não diz de qual conta cada personagem é. Alt novo na guilda
 * só entra na lista no próximo login. O que ela detecta para sempre, mesmo sem
 * a pessoa logar de novo, é saída da guilda e mudança de rank — então nada fica
 * desatualizado por anos.
 */
@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  constructor(
    private readonly blizzard: BlizzardService,
    private readonly repo: MembershipRepository,
  ) {}

  /**
   * A cada 6h, alinhado com o TTL do cache do roster.
   *
   * Mais frequente que isso não melhora nada — o dado da Blizzard não muda mais
   * rápido — e só gasta rate limit.
   */
  @Cron(CronExpression.EVERY_6_HOURS, { name: 'revalidate-membership' })
  async revalidateScheduled(): Promise<void> {
    try {
      await this.revalidateAll();
    } catch (err: unknown) {
      // Exceção aqui não pode subir: no @nestjs/schedule ela viraria unhandled
      // rejection e derrubaria o processo por causa de uma API de terceiro fora
      // do ar. Falhar a rodada é aceitável; a próxima corrige.
      this.logger.error(`Revalidação falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async revalidateAll(): Promise<RevalidationResult> {
    const startedAt = Date.now();

    // force: a rodada existe justamente para trazer dado novo. Reaproveitar o
    // cache faria o job revalidar contra a mesma foto que já usou na rodada
    // anterior.
    const roster = await this.blizzard.getGuildRosterSnapshot(true);

    // Estes dois abortos são o coração da issue: ausência do roster só significa
    // "saiu da guilda" se o roster for confiável. Roster velho ou vazio revogaria
    // a guilda inteira de uma vez.
    if (roster.stale) {
      return this.abort('a Blizzard falhou e o roster veio do cache');
    }
    if (roster.members.length === 0) {
      return this.abort('roster vazio (guilda renomeada ou config errada?)');
    }

    const members = await this.repo.findMembers();
    // Identidade na mesma chave que `Character` guarda — Regra 6.
    const byKey = new Map(
      roster.members.map((m) => [indice(chaveDe({ name: m.name, realm: m.realmSlug })), m]),
    );

    const toRevoke: string[] = [];
    const rankChanges: Array<{ id: string; rank: number }> = [];
    const charRankChanges: Array<{ id: string; rank: number }> = [];
    const charactersGone: string[] = [];
    const unchanged: string[] = [];
    let unverifiable = 0;

    for (const user of members) {
      if (user.characters.length === 0) {
        // Membro sem nenhum personagem não deveria existir pelo fluxo de login.
        // Se existir (edição manual no banco), não dá para verificar — e revogar
        // sem verificar é o mesmo erro que revogar com roster quebrado.
        unverifiable++;
        this.logger.warn(`user=${user.id} é membro sem personagem casado; não dá para revalidar`);
        continue;
      }

      const stillInRoster: Array<{ id: string; rank: number }> = [];

      for (const char of user.characters) {
        // `char.nameKey`/`char.realmKey` já são a chave da identidade — Regra 6.
        const hit = byKey.get(indice(char));

        if (!hit) {
          charactersGone.push(char.id);
          continue;
        }

        stillInRoster.push({ id: char.id, rank: hit.rank });
        if (hit.rank !== char.rank) {
          charRankChanges.push({ id: char.id, rank: hit.rank });
        }
      }

      // Só perde a membership quem não tem NENHUM personagem no roster. Tirar
      // um alt da guilda não pode derrubar o acesso de quem continua dentro.
      if (stillInRoster.length === 0) {
        toRevoke.push(user.id);
        continue;
      }

      // Menor número é o rank mais alto — rank 0 é o guild master.
      const bestRank = Math.min(...stillInRoster.map((c) => c.rank));
      if (bestRank !== user.guildRank) {
        rankChanges.push({ id: user.id, rank: bestRank });
      } else {
        unchanged.push(user.id);
      }
    }

    const charactersRemoved = await this.repo.deleteCharacters(charactersGone);
    for (const change of charRankChanges) {
      await this.repo.updateCharacterRank(change.id, change.rank);
    }

    const sessionsDeleted = await this.repo.revokeMembership(toRevoke);
    for (const change of rankChanges) {
      await this.repo.updateRank(change.id, change.rank);
    }
    await this.repo.touchVerified(unchanged);

    // Log identifica por id interno, nunca por battletag: battletag é dado
    // pessoal e log costuma ir para serviço de terceiro.
    for (const id of toRevoke) {
      this.logger.warn(`Membership revogada user=${id}: nenhum personagem no roster`);
    }
    this.logger.log(
      `Revalidação: ${members.length} membros conferidos contra ${roster.members.length} do roster — ` +
        `${toRevoke.length} revogados (${sessionsDeleted} sessões apagadas), ` +
        `${rankChanges.length} ranks de conta atualizados, ` +
        `${charactersRemoved} personagens saíram, ${unverifiable} sem como verificar ` +
        `(${Date.now() - startedAt}ms)`,
    );

    this.logRankDistribution(roster.members);

    return {
      status: 'ok',
      checked: members.length,
      revoked: toRevoke.length,
      sessionsDeleted,
      ranksUpdated: rankChanges.length,
      charactersRemoved,
      unverifiable,
    };
  }

  /**
   * Distribuição de ranks do roster, a cada rodada.
   *
   * É **registro, não alarme**. A contagem por rank oscila toda semana com
   * entrada e saída de gente, então variação não significa nada e não vale
   * disparar aviso em cima disso.
   *
   * O valor é forense: `rank` é a posição na lista da guilda, não uma
   * identidade, e a API da Blizzard não devolve o nome do rank. Se um dia
   * alguém reordenar os ranks no jogo, o corte de acesso passa a significar
   * outra coisa sem gerar erro nenhum — e este histórico é o que permite achar
   * em qual rodada a estrutura mudou de formato.
   *
   * Quem segura a régua no dia a dia é a definição combinada com a liderança
   * (rank 4 é Raider), não este log. Ver Regra 4 do CLAUDE.md.
   */
  private logRankDistribution(roster: RosterMember[]): void {
    const porRank = new Map<number, number>();
    for (const m of roster) {
      porRank.set(m.rank, (porRank.get(m.rank) ?? 0) + 1);
    }

    const linha = [...porRank.entries()]
      .sort(([a], [b]) => a - b)
      .map(([rank, total]) => `${rank}:${total}`)
      .join(' ');

    this.logger.log(`Distribuição por rank (rank:personagens) — ${linha}`);
  }

  private abort(reason: string): RevalidationResult {
    this.logger.warn(`Revalidação abortada sem revogar ninguém: ${reason}`);
    return { status: 'aborted', reason };
  }
}
