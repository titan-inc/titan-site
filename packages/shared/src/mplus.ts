import { z } from 'zod';

/**
 * Vaga de M+ anunciada no Discord. Ver `docs/specs/mplus-vaga-discord.md`.
 *
 * O primitivo é **o grupo com buracos nomeados**, não a pessoa cadastrada: a
 * vaga descreve o que falta para amanhã à noite e morre junto com a noite. Não
 * existe perfil, não existe agenda, e o sistema não monta grupo nenhum.
 */

/** Roles de um grupo de 5. */
export const MPLUS_ROLES = ['tank', 'healer', 'dps'] as const;
export type MplusRole = (typeof MPLUS_ROLES)[number];

/**
 * O que o grupo **não** tem.
 *
 * Marcado à mão, e não derivado das classes: derivar exigiria cadastrar os três
 * personagens já confirmados antes de anunciar, e ainda poderia discordar de
 * quem a pessoa vai de fato levar. Marcar duas caixas é mais rápido e não
 * desatualiza.
 */
export const MPLUS_BUFFS = ['lust', 'brez'] as const;
export type MplusBuff = (typeof MPLUS_BUFFS)[number];

/**
 * Quantos dias a vaga vive no site, contados da **criação**.
 *
 * Faxina, não política de retenção: a vaga vira lixo depois que a noite passa,
 * e apagar à mão toda vez é trabalho que ninguém faz. Não é base para ler ritmo
 * de M+ da guilda — sete dias é a semana passada, não ritmo.
 */
export const VAGA_EXPURGO_DIAS = 7;

/**
 * Quanto dá para agendar à frente.
 *
 * **Menor que `VAGA_EXPURGO_DIAS` de propósito, e as duas janelas dependem uma
 * da outra.** O expurgo conta da criação, então uma vaga marcada para depois do
 * expurgo sumiria antes da noite acontecer — silenciosamente, que é o pior modo
 * de falhar. Com um dia de folga, a noite sempre chega antes da faxina.
 */
export const VAGA_AGENDAMENTO_MAX_DIAS = VAGA_EXPURGO_DIAS - 1;

/** Tolerância para relógio do cliente adiantado e para o tempo de digitar. */
const ATRASO_TOLERADO_MS = 5 * 60 * 1_000;

const vagasPorRoleSchema = z.object({
  tank: z.number().int().min(0).max(1),
  healer: z.number().int().min(0).max(1),
  dps: z.number().int().min(0).max(3),
});
export type VagasPorRole = z.infer<typeof vagasPorRoleSchema>;

/**
 * O que o formulário manda para criar uma vaga.
 *
 * Nasce aqui e em nenhum outro lugar — Regra 2. O Nest revalida com este mesmo
 * schema; a validação do front é UX, e a do Nest é a que vale (Regra 5).
 */
export const criarVagaSchema = z
  .object({
    /** Quantas vagas de cada role. Pelo menos uma > 0. */
    vagas: vagasPorRoleSchema,

    /**
     * Instante da key, **sempre em UTC**. A tela exibe no fuso de quem lê.
     *
     * A guilda é região US com realms brasileiros e gente morando fora; "21h"
     * sem fuso é ambíguo justamente entre as pessoas que precisam se combinar.
     */
    quando: z.string().datetime(),

    /**
     * Faixa de key como **intenção, nunca filtro**.
     *
     * Serve para o grupo sinalizar se está pushando ou fechando o dever de
     * casa. O sistema nunca usa isto para esconder anúncio de ninguém: quem
     * joga +18 com frequência topa ajudar numa +12, e filtrar esconderia
     * exatamente o convite que seria aceito.
     *
     * **0 é M0, e é nível válido** — não é "+0". Keystone começa no +2, mas
     * mítica 0 é dungeon que se monta grupo para fazer, e na pré-season é a
     * única coisa que existe. A spec original dizia `min(2)`, que descrevia só
     * o keystone e deixava a pré-season inteira de fora.
     *
     * **+1 não existe** em nenhum momento: de M0 o próximo é +2.
     */
    keyMin: z.number().int().min(0).max(40),
    keyMax: z.number().int().min(0).max(40),

    faltando: z.array(z.enum(MPLUS_BUFFS)).max(MPLUS_BUFFS.length),

    observacao: z.string().max(500).optional(),
  })
  .refine((vaga) => vaga.vagas.tank + vaga.vagas.healer + vaga.vagas.dps > 0, {
    message: 'Marque pelo menos uma vaga.',
    path: ['vagas'],
  })
  .refine((vaga) => vaga.keyMax >= vaga.keyMin, {
    message: 'A key máxima não pode ser menor que a mínima.',
    path: ['keyMax'],
  })
  .refine((vaga) => vaga.keyMin !== 1, {
    message: 'Não existe key +1: depois da M0 vem a +2.',
    path: ['keyMin'],
  })
  .refine((vaga) => vaga.keyMax !== 1, {
    message: 'Não existe key +1: depois da M0 vem a +2.',
    path: ['keyMax'],
  })
  .refine((vaga) => new Date(vaga.quando).getTime() > Date.now() - ATRASO_TOLERADO_MS, {
    message: 'Escolha um horário no futuro.',
    path: ['quando'],
  })
  .refine(
    (vaga) =>
      new Date(vaga.quando).getTime() <=
      Date.now() + VAGA_AGENDAMENTO_MAX_DIAS * 24 * 60 * 60 * 1_000,
    {
      message: `A vaga fica no site por ${String(VAGA_EXPURGO_DIAS)} dias, então dá para agendar no máximo ${String(VAGA_AGENDAMENTO_MAX_DIAS)} dias à frente.`,
      path: ['quando'],
    },
  )
  .refine((vaga) => (vaga.faltando?.length ?? 0) === new Set(vaga.faltando).size, {
    message: 'Buff repetido.',
    path: ['faltando'],
  });
export type CriarVaga = z.infer<typeof criarVagaSchema>;

/** Uma vaga como a tela recebe. */
export const vagaSchema = z.object({
  id: z.string(),
  vagas: vagasPorRoleSchema,
  quando: z.string().datetime(),
  keyMin: z.number().int(),
  keyMax: z.number().int(),
  faltando: z.array(z.enum(MPLUS_BUFFS)),
  observacao: z.string().optional(),

  /** Battletag de quem anunciou — é para essa pessoa que se responde. */
  criadaPor: z.string(),
  criadaEm: z.string().datetime(),

  /**
   * A mensagem chegou ao Discord?
   *
   * Falso é estado real e visível, não erro de leitura: a linha é gravada antes
   * da entrega justamente para existir vaga cuja mensagem não chegou. A tela
   * precisa dizer isso, porque ninguém vai responder a um anúncio que não foi
   * publicado.
   */
  entregue: z.boolean(),

  /** Quem está lendo criou esta vaga? Só essa pessoa pode apagá-la. */
  podeApagar: z.boolean(),
});
export type Vaga = z.infer<typeof vagaSchema>;

export const vagaListSchema = z.object({ vagas: z.array(vagaSchema) });
export type VagaList = z.infer<typeof vagaListSchema>;

/** Rótulo de cada role em pt-BR, para tela e para a mensagem do Discord. */
export const ROLE_LABEL: Record<MplusRole, string> = {
  tank: 'tank',
  healer: 'healer',
  dps: 'dps',
};

export const BUFF_LABEL: Record<MplusBuff, string> = {
  lust: 'lust',
  brez: 'brez',
};

/**
 * "healer + 2 dps" — o que falta, em texto.
 *
 * Mora no shared porque a tela e o embed do Discord dizem a **mesma** frase; se
 * cada lado montasse a sua, um dia elas discordariam sobre o mesmo grupo.
 */
export function descreverVagas(vagas: VagasPorRole): string {
  const partes = MPLUS_ROLES.filter((role) => vagas[role] > 0).map((role) =>
    vagas[role] > 1 ? `${String(vagas[role])} ${ROLE_LABEL[role]}` : ROLE_LABEL[role],
  );

  return partes.join(' + ');
}

/**
 * "M0", "+12" ou "+12 a +14".
 *
 * Zero vira **M0**, nunca "+0": mítica 0 não é keystone nível zero, é outra
 * coisa. Escrever "+0" faria o anúncio parecer bug para quem joga.
 */
export function descreverFaixaDeKey(keyMin: number, keyMax: number): string {
  const rotulo = (nivel: number) => (nivel === 0 ? 'M0' : `+${String(nivel)}`);

  return keyMin === keyMax ? rotulo(keyMin) : `${rotulo(keyMin)} a ${rotulo(keyMax)}`;
}
