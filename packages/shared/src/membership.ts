import { z } from 'zod';
import { characterRefSchema } from './wow.js';

/**
 * Modelo de acesso. Ver Regra 4 do CLAUDE.md.
 *
 * DECISÃO (2026-07-30): acesso à área interna depende do **rank na guilda**,
 * não só de estar no roster.
 *
 * A decisão anterior era acesso binário, com `guildRank` gravado mas nunca
 * usado. Ela existia porque o roster misturava alts, raiders e social e a
 * liderança não tinha decidido onde termina "oficial". Os ranks foram
 * reorganizados, a premissa caiu, e a regra mudou junto.
 *
 * São **três** estados, e o do meio existe para evitar um vexame específico:
 * um social que está na guilda há dois anos não pode receber a tela de
 * "candidate-se para entrar na guilda".
 *
 * | estado            | área interna | apply |
 * | ----------------- | ------------ | ----- |
 * | não-membro        | não          | sim   |
 * | membro sem acesso | não          | não   |
 * | membro com acesso | sim          | não   |
 */

/**
 * Presença no roster — **não** é o mesmo que ter acesso.
 *
 * `member` responde "tem personagem na guilda?". Quem responde "entra na área
 * interna?" é `canAccessInternalArea`, que também olha o rank.
 */
export const membershipSchema = z.enum([
  /** Tem pelo menos um personagem no roster da guilda. */
  'member',
  /** Conta Battle.net válida, nenhum personagem no roster. Só pode dar apply. */
  'not-member',
]);
export type Membership = z.infer<typeof membershipSchema>;

/**
 * Usuário da sessão, como o front recebe de `GET /auth/me`.
 *
 * Nunca inclui token da Blizzard nem refresh token — esses ficam no servidor.
 */
export const sessionUserSchema = z.object({
  battletag: z.string(),
  membership: membershipSchema,

  /**
   * Oficial: gateia histórico de outra pessoa e a lista de oficiais.
   *
   * Derivado no servidor de **duas fontes**, bastando uma: rank de oficial na
   * guilda (`GUILD_OFFICER_RANK_MAX`) ou concessão em `OfficerGrant`. Nunca é
   * coluna gravada — ver Regra 4.
   *
   * Gate independente do de acesso: passar do corte dá a área interna, não
   * decisões de liderança.
   */
  isOfficer: z.boolean(),

  /**
   * Melhor rank entre os personagens da conta que estão no roster.
   *
   * **Rank 0 é o mais alto** (guild master) e o número cresce descendo a
   * hierarquia — confirmado no roster real, onde o rank 0 tem exatamente uma
   * pessoa. Por isso todo teste de permissão é `rank <= corte`, nunca `>=`.
   *
   * Nulo quando a conta não tem personagem no roster.
   */
  guildRank: z.number().int().nonnegative().nullable(),

  /**
   * Resposta pronta de "esta pessoa entra na área interna?".
   *
   * Calculado no servidor porque o corte é configuração de ambiente e o front
   * não tem acesso a ela. O front lê este booleano; quem tem o corte em mãos
   * (o Nest) usa `canAccessInternalArea`. Uma regra só, avaliada num lugar só.
   */
  hasInternalAccess: z.boolean(),

  /** Personagem de rank mais alto, para representar a conta na tela. */
  matchedCharacter: characterRefSchema.nullable(),

  /**
   * Quantos personagens da conta estão no roster.
   *
   * Só a contagem: a lista inteira não é necessária para nada que o front faz
   * hoje, e mandar menos dado pessoal por padrão é a escolha certa.
   */
  characterCount: z.number().int().nonnegative(),

  /**
   * Quando a membership foi confirmada contra o roster pela última vez.
   *
   * Atualizado no login e pelo job de revalidação, que roda a cada 6h e derruba
   * as sessões de quem saiu da guilda (TIT-25). Sem esse job, quem sai e não
   * desloga mantém acesso para sempre.
   */
  verifiedAt: z.string().datetime().nullable(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

/**
 * Acesso à área interna: estar no roster **e** estar dentro do corte de rank.
 *
 * `rankAccessMax` vem de `GUILD_RANK_ACCESS_MAX`. Nunca escreva o número aqui
 * nem na regra de negócio: `rank` é a **posição** do rank na lista da guilda,
 * não uma identidade, e reordenar ranks no jogo muda o significado do número
 * sem gerar erro nenhum.
 *
 * `guildRank` nulo bloqueia mesmo com `membership: 'member'`. É estado
 * inconsistente (no roster mas sem rank), e diante de dúvida a resposta segura
 * é negar — liberar por engano expõe dado de presença e loot.
 */
export function canAccessInternalArea(
  user: Pick<SessionUser, 'membership' | 'guildRank'>,
  rankAccessMax: number,
): boolean {
  if (user.membership !== 'member') return false;
  if (user.guildRank === null) return false;
  return user.guildRank <= rankAccessMax;
}

/**
 * Quem pode se candidatar.
 *
 * Só quem **não** está no roster. Membro fora do corte não entra na área
 * interna, mas também não é convidado a se candidatar para uma guilda em que
 * já está.
 */
export function canApply(user: Pick<SessionUser, 'membership'>): boolean {
  return user.membership === 'not-member';
}

/** Só o que as permissões de oficial têm em comum. */
type OfficerCheck = Pick<SessionUser, 'hasInternalAccess' | 'isOfficer'>;

/**
 * Precondição de **qualquer** ação de oficial: estar na área interna e ser
 * oficial (por rank ou por concessão — ver `officers.ts`).
 *
 * Existe para o guard genérico do Nest ter o que chamar sem escolher uma das
 * permissões específicas abaixo — um guard de oficial que checasse
 * `canSeeOthersHistory` para proteger a lista de oficiais passaria a mentir no
 * dia em que as duas divergissem.
 *
 * Exigir membership junto é o que faz sair da guilda derrubar o acesso mesmo
 * que ninguém lembre de revogar a concessão.
 */
export function isActingOfficer(user: OfficerCheck): boolean {
  return user.hasInternalAccess && user.isOfficer;
}

/**
 * Conceder e revogar o próprio status de oficial.
 *
 * Autorreferente: quem pode isto pode se dar as outras. Por isso a tela é gated
 * por ela mesma, e o serviço recusa revogar o último oficial.
 */
export function canManageOfficers(user: OfficerCheck): boolean {
  return isActingOfficer(user);
}

/**
 * Ver o histórico de **outra pessoa** (presença, loot, evolução) — Regra 7.
 *
 * Membro vê o próprio histórico inteiro; só oficial vê o dos outros. O motivo é
 * **social, não de sigilo**: presença e progressão estão abertas no Logs e no
 * WoWAudit, então o dado não é secreto. O que o site evita é apresentá-lo em
 * forma de comparação entre pares, que gera treta sem ajudar o raid leader a
 * decidir nada — quem lidera a raid já tem o detalhe.
 *
 * Dá no mesmo que `canManageOfficers` hoje e mesmo assim é uma função
 * separada, de propósito: são decisões diferentes sobre dados diferentes, e
 * uma pode mudar sem a outra.
 *
 * Delegar a `isActingOfficer` não é o mesmo que colapsar: mudar esta permissão
 * é substituir o corpo desta função, sem tocar na outra.
 *
 * **Não vale para loot.** O histórico de loot é visível a todos que entram na
 * área interna, porque é decisão que o conselho tomou na frente da raid, não
 * comportamento de uma pessoa — ver a Regra 7 do CLAUDE.md. Quem for construir
 * tela de loot não deve chamar esta função.
 */
export function canSeeOthersHistory(user: OfficerCheck): boolean {
  return isActingOfficer(user);
}
