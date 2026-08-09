import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  toCharacterKey,
  toSlug,
  type CreateOfficerGrant,
  type OfficerGrant,
  type OfficerList,
} from '@titan/shared';
import { BlizzardService, type RosterMember } from '../blizzard/blizzard.service';
import { OfficersRepository } from './officers.repository';

/**
 * A lista manual de oficiais — Regra 4.
 *
 * O service não decide quem é oficial: quem decide é a pessoa que abre a tela e
 * digita um personagem. O que ele faz é impedir que essa decisão vire uma linha
 * inútil no banco por causa de um nome errado, e impedir que a guilda fique sem
 * nenhum oficial.
 */
@Injectable()
export class OfficersService {
  private readonly logger = new Logger(OfficersService.name);

  constructor(
    private readonly repo: OfficersRepository,
    private readonly blizzard: BlizzardService,
  ) {}

  /**
   * Lista os grants com dois enfeites que importam: rank atual e se alguma
   * conta já casou.
   *
   * Roster fora do ar não derruba a tela — os ranks vêm nulos e a lista aparece
   * mesmo assim, que é o degradar da Regra 6. Conceder, esse sim, exige roster.
   */
  async list(): Promise<OfficerList> {
    const [grants, conhecidos] = await Promise.all([
      this.repo.findAll(),
      this.repo.findKnownCharacterKeys(),
    ]);

    const roster = await this.rosterPorChave().catch(() => {
      this.logger.warn('Roster indisponível; a lista de oficiais vai sem rank');
      return new Map<string, RosterMember>();
    });

    const vinculados = new Set(
      conhecidos.map((c) => `${toSlug(c.realmSlug)}/${toCharacterKey(c.nameKey)}`),
    );

    return {
      grants: grants.map((g): OfficerGrant => {
        const chave = `${toSlug(g.realmSlug)}/${toCharacterKey(g.nameKey)}`;

        return {
          id: g.id,
          name: g.name,
          realm: g.realm,
          nameKey: g.nameKey,
          realmSlug: g.realmSlug,
          rank: roster.get(chave)?.rank ?? null,
          linked: vinculados.has(chave),
          grantedBy: g.grantedBy,
          grantedAt: g.grantedAt.toISOString(),
        };
      }),
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

    await this.repo.upsert({
      nameKey: alvo.nameKey,
      realmSlug: alvo.realmSlug,
      name: alvo.name,
      realm: alvo.realmSlug,
      grantedBy,
    });

    this.logger.log(`Oficial concedido a ${alvo.name}-${alvo.realmSlug} por ${grantedBy}`);

    // Devolve a lista inteira, e não só o criado: a tela precisa dela de
    // qualquer jeito, e montar o item aqui duplicaria o mapeamento do list().
    return this.list();
  }

  /**
   * Revoga.
   *
   * Recusa apagar o último grant. Sem isso, um clique deixa a guilda com zero
   * oficiais — e como a própria tela é gated por oficial, ninguém consegue
   * desfazer pelo site. O conserto seria `INSERT` manual no banco de produção.
   */
  async revoke(id: string, revokedBy: string): Promise<OfficerList> {
    const grant = await this.repo.findById(id);
    if (!grant) throw new NotFoundException('Essa concessão não existe mais.');

    if ((await this.repo.count()) <= 1) {
      throw new ConflictException(
        'Este é o último oficial. Conceda a outra pessoa antes de revogar este, ' +
          'ou ninguém mais consegue abrir esta tela.',
      );
    }

    await this.repo.delete(id);
    this.logger.log(`Oficial revogado de ${grant.name}-${grant.realmSlug} por ${revokedBy}`);

    return this.list();
  }

  /** Roster indexado pela mesma chave usada no casamento de grants. */
  private async rosterPorChave(): Promise<Map<string, RosterMember>> {
    const roster = await this.blizzard.getGuildRosterSnapshot();
    return new Map(roster.members.map((m) => [`${m.realmSlug}/${m.nameKey}`, m]));
  }
}
