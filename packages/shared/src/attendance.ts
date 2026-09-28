import { z } from 'zod';

/**
 * Presença de raid: o que a pessoa **disse** cruzado com o que ela **fez**.
 *
 * O signup diz quem confirmou; o log diz quem estava na pull. O valor está no
 * cruzamento — e no cuidado com o único quadrante que o log não desambigua.
 */

/**
 * Status do signup, como o WoWAudit entrega.
 *
 * **Nasce auto-declarado e termina como correção do raid leader.** A pessoa
 * marca antes da raid; depois da noite, o RL edita para refletir o que de fato
 * aconteceu — `Standby` vira "veio e ficou de banco", `Absent` vira "não veio".
 *
 * Por isso existem dois valores por linha, e não um: o congelado antes da raid
 * (`signupDeclared`) e o de agora. Ver `toAttendanceState()`.
 *
 * `Late` é a pessoa avisando que chega atrasada, o que é melhor que derivar do
 * índice da pull. Se acabou no banco, o RL sobrescreve com `Standby`.
 *
 * NÃO usar `selected` do WoWAudit como designação de banco: veio `true` em 168
 * de 168 signups da amostra, inclusive nos `Absent`.
 */
export const SIGNUP_STATUSES = [
  'Present',
  'Absent',
  'Late',
  'Standby',
  'Tentative',
  'Unknown',
] as const;
export const signupStatusSchema = z.enum(SIGNUP_STATUSES);
export type SignupStatus = z.infer<typeof signupStatusSchema>;

/**
 * O que aconteceu com uma pessoa numa noite.
 *
 * `nao-raidou` é o **único** estado ambíguo, e é deliberadamente genérico: quem
 * foi para o banco na hora e quem furou não aparecem em pull nenhuma, e o log
 * não distingue os dois. São coisas socialmente opostas. O sistema grava o fato
 * observável e o raid leader anota o motivo depois, se quiser — a correção do
 * humano é o que fica, nunca a inferência.
 *
 * `sem-dado` não é falta. Log pode ser enviado dias depois, ou nunca; noite sem
 * log é noite sem informação, e transformar isso em falta acusaria a raid
 * inteira de furar.
 */
export const ATTENDANCE_STATES = [
  /** Confirmou e raidou. */
  'presente',
  /** Raidou sem ter confirmado. */
  'sem-confirmar',
  /**
   * Raidou, e não há lista de signup para a noite.
   *
   * Não é o mesmo que `sem-confirmar`. O WoWAudit devolve signups só a partir
   * de 2026: as 83 noites de 2024–2025 vêm com a lista vazia. Sem este estado,
   * o backfill diria que 2934 vezes alguém "apareceu sem confirmar" — inventando
   * uma indisciplina que ninguém cometeu, a partir de dado que não existe.
   */
  'raidou',
  /** Confirmou e não apareceu. AMBÍGUO — só o humano resolve. */
  'nao-raidou',
  /**
   * Confirmou antes e o raid leader marcou `Absent` depois: **furou**.
   *
   * Não é `nao-raidou`: ali o log não sabe se foi banco ou furo, aqui o RL já
   * disse. E não é `ausente`, que é ter declinado com antecedência — a coisa
   * socialmente oposta. Só existe com `signupDeclared` gravado.
   */
  'furou',
  /** Banco declarado no próprio signup (`Standby`). */
  'banco',
  /** Declinou no signup (`Absent`) e não raidou. */
  'ausente',
  /** Não confirmou e não raidou — provável rotação. */
  'rotacao',
  /** A noite não tem log. Ausência de informação, não de pessoa. */
  'sem-dado',
] as const;
export const attendanceStateSchema = z.enum(ATTENDANCE_STATES);
export type AttendanceState = z.infer<typeof attendanceStateSchema>;

/**
 * Deriva o estado a partir do fato bruto.
 *
 * Pura e no shared porque o mesmo cruzamento aparece no job que grava e na tela
 * que mostra. Duas implementações divergiriam em silêncio, e o que está em jogo
 * é a reputação de gente.
 *
 * @param signup status do signup **agora** — depois da noite, é a correção do
 *   raid leader. Null se a pessoa nem apareceu no signup
 * @param raided true/false do log; **null quando a noite não tem log**
 * @param hasSignupData a noite tem lista de signup? `false` para noite antiga,
 *   em que o WoWAudit não guardou nada — e aí "não confirmou" não é afirmável
 * @param declared o que estava declarado **antes de a raid começar**, congelado
 *   pelo job. Null quando não dá para afirmar — e aí a derivação cai no
 *   comportamento antigo em vez de inventar
 */
export function toAttendanceState(
  signup: SignupStatus | null,
  raided: boolean | null,
  hasSignupData = true,
  declared: SignupStatus | null = null,
): AttendanceState {
  if (raided === null) return 'sem-dado';

  // Sem lista de signup, o único fato é ter raidado. Concluir "não confirmou"
  // de uma lista que não existe é inventar acusação.
  if (!hasSignupData) return raided ? 'raidou' : 'sem-dado';

  if (raided) {
    // Confirmou de algum jeito e apareceu. `Standby` que acabou raidando conta
    // como presente: o que vale é o que aconteceu.
    return signup === 'Present' || signup === 'Late' || signup === 'Standby'
      ? 'presente'
      : 'sem-confirmar';
  }

  switch (signup) {
    case 'Standby':
      return 'banco';
    case 'Absent':
      // `Absent` agora tem duas origens opostas, e só o declarado separa:
      // quem sempre disse que não vinha, e quem confirmou e o RL rebaixou
      // depois de não aparecer. Sem o declarado, não dá para afirmar o furo.
      return declared === 'Present' || declared === 'Late' ? 'furou' : 'ausente';
    case 'Present':
    case 'Late':
      // O quadrante ambíguo: disse que vinha e não está em pull nenhuma.
      return 'nao-raidou';
    default:
      // Tentative, Unknown e sem signup. Não prometeu nada, então não faltou.
      return 'rotacao';
  }
}

/** Estados que contam como "esteve na raid", para taxa de presença. */
export function isPresent(state: AttendanceState): boolean {
  return state === 'presente' || state === 'sem-confirmar' || state === 'raidou';
}

/**
 * Estados que pedem uma anotação do raid leader.
 *
 * Só um. A API do WoWAudit encolheu esse conjunto: `Standby` e `Absent` já vêm
 * declarados, então o trabalho manual do RL é bem menor do que parecia.
 *
 * `furou` **não** entra: ali o RL já disse o que aconteceu ao editar o signup
 * para `Absent`. Pedir que ele anote de novo seria cobrar duas vezes o mesmo
 * trabalho, e encheria a tela de pendência que não é pendência.
 */
export function needsReview(state: AttendanceState): boolean {
  return state === 'nao-raidou';
}

export const attendanceEntrySchema = z.object({
  /** Id da linha. É o alvo da anotação do raid leader. */
  id: z.string(),

  /** Identidade sempre nome + realm, nunca o nome sozinho — Regra 6. */
  name: z.string(),
  realm: z.string(),

  /** O signup como está agora — depois da noite, a correção do RL. */
  signup: signupStatusSchema.nullable(),

  /**
   * O que estava declarado antes de a raid começar.
   *
   * Null nas noites gravadas antes deste campo existir, e nas que entraram no
   * banco já depois de acontecer. Null não é "não confirmou" — é "não dá para
   * saber o que foi confirmado".
   */
  signupDeclared: signupStatusSchema.nullable(),

  /** Null = a noite não tem log. Nunca confundir com `false`. */
  raided: z.boolean().nullable(),

  state: attendanceStateSchema,

  /** Em que pull de boss entrou (1 = a primeira). Null se não raidou. */
  firstPull: z.number().int().nullable(),

  /** Em quantas pulls de boss apareceu. */
  pulls: z.number().int().nullable(),

  /**
   * Anotação do raid leader. É a **correção do humano** e o job nunca a
   * sobrescreve ao reprocessar a noite.
   */
  note: z.string().nullable(),
});
export type AttendanceEntry = z.infer<typeof attendanceEntrySchema>;

export const raidNightInfoSchema = z.object({
  id: z.number().int(),

  /** Data de calendário no fuso da guilda, "2026-07-28". */
  date: z.string(),

  title: z.string(),
  instance: z.string(),
  difficulty: z.string(),

  /**
   * Run extra / de alt.
   *
   * Gravada sempre, contada separado: comparar quem foi a uma run de alt com
   * quem foi à raid oficial distorce os dois lados, mas descartar seria injusto
   * ao contrário com quem apareceu.
   */
  optional: z.boolean(),

  /** Relatórios do WCL casados com esta noite. Vazio = noite sem log. */
  reportCodes: z.string().array(),

  /** Pulls de boss da noite. Null = sem log. */
  bossPulls: z.number().int().nullable(),

  /**
   * A noite tem lista de signup?
   *
   * `false` para as noites de 2024–2025, em que o WoWAudit devolve a lista
   * vazia. Sem esta distinção, "não confirmou" seria afirmado a partir de dado
   * inexistente.
   */
  hasSignups: z.boolean(),
});
export type RaidNightInfo = z.infer<typeof raidNightInfoSchema>;

/** A noite com quem esteve nela. Só oficial recebe isto — Regra 7. */
export const raidNightSchema = raidNightInfoSchema.extend({
  entries: attendanceEntrySchema.array(),
});
export type RaidNight = z.infer<typeof raidNightSchema>;

/**
 * As noites, com o detalhe de todo mundo. **Só oficial** — Regra 7.
 *
 * Havia um `myAttendanceSchema` ao lado deste, com o próprio histórico do
 * membro. Saiu na TIT-150 junto com o endpoint: os players não entram no site,
 * e a tela virou ferramenta do raid leader. Removido em vez de deixado sem uso,
 * pelo mesmo motivo que tirou o `canReviewApplications()` daqui — contrato
 * órfão convida alguém a reconstruir a tela em cima dele.
 */
export const attendanceReportSchema = z.object({
  nights: raidNightSchema.array(),
});
export type AttendanceReport = z.infer<typeof attendanceReportSchema>;
