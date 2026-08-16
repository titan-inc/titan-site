import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  isOfficerByRank,
  toSlug,
  type CreateOfficerGrant,
  type OfficerByRank,
  type OfficerGrant,
  type OfficerList,
} from '@titan/shared';
import { BlizzardService, type RosterMember } from '../blizzard/blizzard.service';
import { chaveDe, CharactersRepository, indice } from '../characters/characters.repository';
import { loadGuildConfig, type GuildConfig } from '../config/guild.config';
import { OfficersRepository } from './officers.repository';

/**
 * Quem é oficial — Regra 4.
 *
 * Escreve só a **lista manual**. A outra fonte (rank) é derivada do roster a
 * cada leitura e não tem escrita aqui; `list()` devolve as duas porque a tela
 * mostra as duas.
 */
@Injectable()
export class OfficersService {
  private readonly logger = new Logger(OfficersService.name);
  private readonly guild: GuildConfig;

  constructor(
    private readonly repo: OfficersRepository,
    private readonly blizzard: BlizzardService,
    private readonly characters: CharactersRepository,
  ) {
    this.guild = loadGuildConfig();
  }

  /**
   * As duas fontes, com rank atual e se alguma conta já casou.
   *
   * Roster fora do ar degrada em vez de derrubar (Regra 6): ranks nulos,
   * automáticos vazios, e `rosterOk` avisando que é lacuna, não zero. Conceder,
   * esse sim, exige roster.
   */
  async list(): Promise<OfficerList> {
    const [grants, conhecidos] = await Promise.all([
      this.repo.findAll(),
      this.repo.findKnownCharacters(),
    ]);

    const membros = await this.rosterMembros();
    // Identidade do roster vivo, na mesma chave que `Character` guarda —
    // Regra 6: `nameKey` mantém acento, `realmKey` é a chave frouxa.
    const porChave = new Map(
      (membros ?? []).map((m) => [indice(chaveDe({ name: m.name, realm: m.realmSlug })), m]),
    );
    const idsConhecidos = new Set(conhecidos.map((c) => c.characterId));
    const chavesConhecidas = new Set(conhecidos.map((c) => indice(c)));

    return {
      officerRankMax: this.guild.officerRankMax,
      rosterOk: membros !== null,

      grants: grants.map((g): OfficerGrant => {
        const chave = indice({ nameKey: g.character.nameKey, realmKey: g.character.realmKey });

        return {
          id: g.id,
          name: g.character.name,
          realm: g.character.realm,
          nameKey: g.character.nameKey,
          realmSlug: toSlug(g.character.realm),
          rank: porChave.get(chave)?.rank ?? null,
          linked: idsConhecidos.has(g.characterId),
          grantedBy: g.grantedBy,
          grantedAt: g.grantedAt.toISOString(),
        };
      }),

      // Derivada, nunca gravada: some e volta com o roster. Ordena por rank e
      // depois por nome para a tela ficar estável entre requisições — a ordem
      // que a Blizzard devolve o roster não é.
      byRank: (membros ?? [])
        .filter((m) => isOfficerByRank(m.rank, this.guild.officerRankMax))
        .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
        .map((m): OfficerByRank => ({
          name: m.name,
          realm: m.realmSlug,
          nameKey: m.nameKey,
          realmSlug: m.realmSlug,
          rank: m.rank,
          linked: chavesConhecidas.has(indice(chaveDe({ name: m.name, realm: m.realmSlug }))),
        })),
    };
  }

  /**
   * Concede, resolvendo o personagem contra o roster antes de gravar.
   *
   * Validar aqui não é preciosismo. Um grant com nome errado é indistinguível
   * de um grant certo até a pessoa tentar entrar e não conseguir — e ninguém
   * relaciona as duas coisas semanas depois. Foi exatamente o que aconteceu com
   * "Saths", que não existe no roster.
   *
   * O que fica gravado é a grafia da **Blizzard**, não a digitada: assim o
   * `nameKey` casa com o que o login grava em `GuildCharacter`.
   */
  async grant(input: CreateOfficerGrant, grantedBy: string): Promise<OfficerList> {
    const roster = await this.blizzard.getGuildRosterSnapshot();

    if (roster.members.length === 0) {
      // Aceitar sem poder conferir é como revogar com roster vazio na
      // revalidação: a decisão fica tomada em cima de nada.
      throw new BadRequestException(
        'Não foi possível conferir o roster da guilda agora. Tente de novo em alguns minutos.',
      );
    }

    const realmSlug = toSlug(input.realm);
    // Nome DIGITADO usa toSlug dos dois lados — tolerar acento é desejável aqui,
    // porque ninguém deve errar a concessão por causa de um trema. Ver Regra 6.
    const nomeDigitado = toSlug(input.name);

    const candidatos = roster.members.filter(
      (m) => m.realmSlug === realmSlug && toSlug(m.name) === nomeDigitado,
    );

    // `at(0)` e não desestruturação: com noUncheckedIndexedAccess, testar o
    // elemento é o que estreita o tipo — testar `length` não estreita.
    const alvo = candidatos.at(0);

    if (!alvo) {
      throw new NotFoundException(
        `${input.name}-${input.realm} não está no roster da guilda. Confira a grafia e o realm.`,
      );
    }

    if (candidatos.length > 1) {
      // Shrëwd, Shrêwd e Shrèwd colapsam no mesmo slug e são pessoas
      // diferentes, com ranks diferentes. Escolher uma delas por conta própria
      // seria dar acesso a dado pessoal para quem não foi escolhido.
      const grafias = candidatos.map((m) => m.name).join(', ');
      throw new ConflictException(
        `Mais de um personagem com esse nome em ${input.realm}: ${grafias}. ` +
          'Digite a grafia exata, com acento.',
      );
    }

    // A Blizzard vence a grafia: `alvo` veio do roster agora mesmo.
    const characterId = await this.characters.resolverDoRoster({
      name: alvo.name,
      realm: alvo.realmSlug,
    });
    await this.repo.upsert({ characterId, grantedBy });

    this.logger.log(`Oficial concedido a ${alvo.name}-${alvo.realmSlug} por ${grantedBy}`);

    // Devolve a lista inteira, e não só o criado: a tela precisa dela de
    // qualquer jeito, e montar o item aqui duplicaria o mapeamento do list().
    return this.list();
  }

  /**
   * Revoga. Recusa se isso zerar os oficiais — a tela é gated por oficial, e o
   * conserto seria `INSERT` em produção.
   *
   * Olha as **duas** fontes desde 10/08/2026: com rank promovendo sozinho,
   * apagar o último grant não tranca ninguém, e recusar seria barrar revogação
   * legítima.
   */
  async revoke(id: string, revokedBy: string): Promise<OfficerList> {
    const grant = await this.repo.findById(id);
    if (!grant) throw new NotFoundException('Essa concessão não existe mais.');

    if ((await this.repo.count()) <= 1) {
      const automaticos = await this.contarOficiaisPorRank();

      // Roster fora do ar é "não sei", não "não tem" — e aqui a diferença é
      // entre recusar por um minuto e trancar a guilda para fora de vez.
      if (automaticos === null) {
        throw new ConflictException(
          'Este é o último oficial concedido à mão, e não deu para conferir o roster agora ' +
            'para saber se algum rank de oficial cobre a lista. Tente de novo em alguns minutos.',
        );
      }

      if (automaticos === 0) {
        throw new ConflictException(
          `Este é o último oficial, e nenhum personagem está nos ranks de oficial da guilda ` +
            `(0 a ${this.guild.officerRankMax}). Conceda a outra pessoa antes de revogar este, ` +
            'ou ninguém mais consegue abrir esta tela.',
        );
      }
    }

    await this.repo.delete(id);
    this.logger.log(
      `Oficial revogado de ${grant.character.name}-${grant.character.realm} por ${revokedBy}`,
    );

    return this.list();
  }

  /**
   * Quantos personagens do roster estão nos ranks de oficial.
   *
   * Null = o roster não respondeu. É diferente de zero de propósito: quem
   * chama decide o que fazer com a dúvida.
   */
  private async contarOficiaisPorRank(): Promise<number | null> {
    const membros = await this.rosterMembros();
    if (membros === null) return null;

    return membros.filter((m) => isOfficerByRank(m.rank, this.guild.officerRankMax)).length;
  }

  /**
   * Membros do roster, ou null quando não dá para confiar no que veio.
   *
   * Roster vazio conta como null: ~590 membros nunca devolvem zero de verdade,
   * então zero é falha. Mesmo julgamento do `grant()`.
   */
  private async rosterMembros(): Promise<RosterMember[] | null> {
    const roster = await this.blizzard.getGuildRosterSnapshot().catch(() => null);

    if (roster === null || roster.members.length === 0) {
      this.logger.warn('Roster indisponível; sem rank e sem os oficiais automáticos');
      return null;
    }

    return roster.members;
  }
}
