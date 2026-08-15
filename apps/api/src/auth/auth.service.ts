import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  canAccessInternalArea,
  isOfficerByGrants,
  isOfficerByRank,
  type SessionUser,
} from '@titan/shared';
import { BlizzardService } from '../blizzard/blizzard.service';
import { loadGuildConfig, type GuildConfig } from '../config/guild.config';
import {
  AuthRepository,
  type MatchedCharacterInput,
  type UserWithCharacters,
} from './auth.repository';

/** Duração da sessão. Curta o suficiente para revalidar membership com frequência. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * O personagem que representa a conta na tela: o de rank mais alto.
 *
 * A guilda inteira do usuário está no banco, mas a UI mostra um. Escolher o de
 * maior rank evita apresentar um alt de bank como se fosse o main.
 */
/** O personagem, achatado do jeito que o resto do serviço espera. */
function paraRef(personagem: {
  rank: number;
  character: { name: string; realm: string };
}): { name: string; realmSlug: string; rank: number } {
  return {
    name: personagem.character.name,
    realmSlug: personagem.character.realm,
    rank: personagem.rank,
  };
}

function pickRepresentative(
  characters: readonly { name: string; realmSlug: string; rank: number }[],
): SessionUser['matchedCharacter'] {
  const best = characters.reduce<(typeof characters)[number] | null>(
    (acc, c) => (acc === null || c.rank < acc.rank ? c : acc),
    null,
  );

  return best ? { name: best.name, realm: best.realmSlug, region: 'us' } : null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly guild: GuildConfig;

  constructor(
    private readonly blizzard: BlizzardService,
    private readonly repo: AuthRepository,
  ) {
    this.guild = loadGuildConfig();
  }

  /** Token opaco de 256 bits. Não é previsível, então não precisa ser assinado. */
  createOpaqueToken(): string {
    return randomBytes(32).toString('hex');
  }

  buildAuthorizeUrl(state: string, redirectUri: string, forceLogin = false): string {
    return this.blizzard.buildAuthorizeUrl(state, redirectUri, forceLogin);
  }

  /**
   * Fluxo completo do callback: code → conta → membership → sessão.
   *
   * Retorna o id da sessão para o controller pôr no cookie.
   */
  async completeLogin(
    code: string,
    redirectUri: string,
  ): Promise<{ sessionId: string; user: UserWithCharacters }> {
    const startedAt = Date.now();

    const userToken = await this.blizzard.exchangeCodeForUserToken(code, redirectUri);
    const afterToken = Date.now();

    // As três em paralelo: só a troca do code é sequencial (as outras dependem
    // do token). Antes o userinfo rodava sozinho antes das outras duas, somando
    // uma ida e volta à Blizzard sem motivo.
    //
    // O roster normalmente vem do cache aquecido no boot; só a primeira chamada
    // depois de 6h paga a rede.
    const [account, characters, roster] = await Promise.all([
      this.blizzard.getAccountInfo(userToken),
      this.blizzard.getAccountCharacters(userToken),
      this.blizzard.getGuildRoster(),
    ]);
    const afterProfile = Date.now();

    // Interseção por slug normalizado. Comparar string crua falharia
    // silenciosamente com nomes acentuados — ver toSlug no shared.
    const rosterByKey = new Map(roster.map((m) => [`${m.realmSlug}/${m.nameKey}`, m]));

    // TODOS os personagens da conta que estão no roster, não só o melhor.
    //
    // Guardar um só fazia o job de revalidação revogar acesso de membro
    // legítimo quando aquele personagem específico saía da guilda, mesmo com
    // outros ainda dentro. Ver Regra 4 do CLAUDE.md.
    const matched: MatchedCharacterInput[] = [];
    for (const char of characters) {
      const hit = rosterByKey.get(`${char.realmSlug}/${char.nameKey}`);
      if (hit) {
        matched.push({
          nameKey: char.nameKey,
          realmSlug: char.realmSlug,
          name: hit.name,
          rank: hit.rank,
        });
      }
    }

    // Menor número é o rank mais alto — rank 0 é o guild master.
    const bestRank = matched.length > 0 ? Math.min(...matched.map((c) => c.rank)) : null;

    const user = await this.repo.upsertUser({
      battlenetId: account.battlenetId,
      battletag: account.battletag,
      membership: matched.length > 0 ? 'member' : 'not_member',
      guildRank: bestRank,
      characters: matched,
    });

    const sessionId = this.createOpaqueToken();
    await this.repo.createSession(sessionId, user.id, new Date(Date.now() + SESSION_TTL_MS));

    // Loga o id interno, NÃO o battletag: battletag é dado pessoal, e em
    // produção log costuma ir para serviço de terceiro.
    //
    // Os tempos existem porque o callback é a única parte do fluxo que a pessoa
    // espera olhando tela em branco. Sem medição, "está lento" vira chute.
    this.logger.log(
      `Login user=${user.id} ${bestRank === null ? 'não-membro' : `membro rank=${bestRank}`} ` +
        `chars=${characters.length} na conta, ${matched.length} no roster ` +
        `(token ${afterToken - startedAt}ms, perfil+roster ${afterProfile - afterToken}ms, ` +
        `total ${Date.now() - startedAt}ms)`,
    );

    // Oportunístico: evita a tabela crescer sem limite sem precisar de job.
    void this.repo.deleteExpiredSessions().catch(() => undefined);

    return { sessionId, user };
  }

  /** Resolve a sessão do cookie. Null = sem sessão válida. */
  async resolveSession(sessionId: string | undefined): Promise<UserWithCharacters | null> {
    if (!sessionId) return null;

    const session = await this.repo.findSessionWithUser(sessionId);
    if (!session) return null;

    if (session.expiresAt.getTime() < Date.now()) {
      await this.repo.deleteSession(sessionId);
      return null;
    }

    return session.user;
  }

  async logout(sessionId: string | undefined): Promise<void> {
    if (sessionId) await this.repo.deleteSession(sessionId);
  }

  /**
   * Projeção do User para o front. Nunca inclui token da Blizzard.
   *
   * `hasInternalAccess` é resolvido aqui porque o corte de rank é configuração
   * do servidor e o front não tem acesso a ela. A regra em si mora no shared —
   * aqui só se aplica o corte a ela.
   *
   * É `async` por causa do `isOfficer`: derivado a cada leitura, não coluna.
   * Custa uma consulta numa tabela minúscula e paga com revogação imediata.
   */
  async toSessionUser(user: UserWithCharacters): Promise<SessionUser> {
    const membership = user.membership === 'member' ? ('member' as const) : ('not-member' as const);
    const grants = await this.repo.findOfficerGrants();

    // Duas fontes independentes, basta uma — Regra 4. Separadas porque
    // respondem perguntas diferentes e uma pode mudar sem a outra.
    const porGrant = isOfficerByGrants(
      user.characters.map((c) => c.characterId),
      grants,
    );
    const porRank = isOfficerByRank(user.guildRank, this.guild.officerRankMax);

    return {
      battletag: user.battletag,
      membership,
      isOfficer: porGrant || porRank,
      guildRank: user.guildRank,
      hasInternalAccess: canAccessInternalArea(
        { membership, guildRank: user.guildRank },
        this.guild.rankAccessMax,
      ),
      // O personagem de rank mais alto representa a pessoa na UI. Empate cai
      // no primeiro, e tanto faz: são o mesmo rank.
      matchedCharacter: pickRepresentative(user.characters.map(paraRef)),
      characterCount: user.characters.length,
      // Do melhor rank para o pior — rank 0 é o mais alto. É a ordem que o
      // select de entrar na sessão quer, com o representante em cima.
      characters: [...user.characters]
        .sort((a, b) => a.rank - b.rank)
        .map((c) => ({
          name: c.character.name,
          realm: c.character.realm,
          region: this.guild.region,
        })),
      verifiedAt: user.verifiedAt?.toISOString() ?? null,
    };
  }

  get sessionTtlMs(): number {
    return SESSION_TTL_MS;
  }
}
