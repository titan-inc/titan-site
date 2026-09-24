import { z } from 'zod';
import type { LeituraDoReport } from './leitura-wcl';

/**
 * O snapshot de um report oficial, congelado no Auditar (D-76; spec §7.2, §7.5).
 *
 * Discovery identifica os reports → Auditar congela os dados externos →
 * Calcular é determinístico sobre os snapshots persistidos. O snapshot guarda
 * **só** o que os cálculos leem — as fights Mythic dos encounters da rodada, os
 * atores que as mortes e as tabelas citam, as mortes dessas fights e, de cada
 * kill, as tabelas e os rankings —, projetado para os campos que o Titan Bet
 * usa. Nunca o payload bruto do WCL. A proveniência (`code`, `title`,
 * `revision`, `startTime`) vai junto, e o banco a amarra à referência congelada.
 *
 * Versionado: um formato novo é `versao: 2`, lido por um schema novo — o
 * antigo continua legível.
 */

const fightSchema = z
  .object({
    id: z.number().int(),
    encounterID: z.number().int(),
    difficulty: z.number().int().nullable(),
    kill: z.boolean().nullable(),
    startTime: z.number(),
    endTime: z.number(),
  })
  .strict();

const atorSchema = z
  .object({ id: z.number().int(), name: z.string(), server: z.string() })
  .strict();

const morteSchema = z
  .object({ fight: z.number().int(), targetID: z.number().int(), timestamp: z.number() })
  .strict();

const linhaSchema = z
  .object({ id: z.number().int(), name: z.string(), total: z.number() })
  .strict();

const rankingSchema = z
  .object({
    name: z.string(),
    server: z.object({ name: z.string() }).strict(),
    spec: z.string(),
    amount: z.number(),
    rankPercent: z.number(),
    bracketPercent: z.number(),
  })
  .strict();

const dispelsSchema = z
  .object({
    entries: z.array(
      z
        .object({
          name: z.string().optional(),
          entries: z
            .array(
              z
                .object({
                  name: z.string().optional(),
                  details: z.array(linhaSchema).optional(),
                })
                .strict(),
            )
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();

const killSchema = z
  .object({
    damage: z.array(linhaSchema),
    healing: z.array(linhaSchema),
    dispels: dispelsSchema,
    rankingsDps: z.array(rankingSchema),
    rankingsHps: z.array(rankingSchema),
  })
  .strict();

export const snapshotDoReportSchema = z
  .object({
    versao: z.literal(1),
    code: z.string(),
    title: z.string(),
    revision: z.number().int(),
    startTime: z.number(),
    fights: z.array(fightSchema),
    actors: z.array(atorSchema),
    deaths: z.array(morteSchema),
    /** Por fight id, só as kills. Chave em texto: é JSON. */
    kills: z.record(z.string().regex(/^\d+$/), killSchema),
  })
  .strict();
export type SnapshotDoReport = z.infer<typeof snapshotDoReportSchema>;

/**
 * Da leitura do WCL ao snapshot: recorta pelos encounters da rodada e projeta
 * cada item para os campos tipados — o que o WCL mandar a mais não passa.
 */
export function congelarReport(
  leitura: LeituraDoReport,
  title: string,
  encounterIds: readonly number[],
): SnapshotDoReport {
  const fights = leitura.fights
    .filter((f) => encounterIds.includes(f.encounterID))
    .map((f) => ({
      id: f.id,
      encounterID: f.encounterID,
      difficulty: f.difficulty,
      kill: f.kill,
      startTime: f.startTime,
      endTime: f.endTime,
    }));
  const daRodada = new Set(fights.map((f) => f.id));

  const deaths = leitura.deaths
    .filter((d) => daRodada.has(d.fight))
    .map((d) => ({ fight: d.fight, targetID: d.targetID, timestamp: d.timestamp }));

  const linha = (l: { id: number; name: string; total: number }) => ({
    id: l.id,
    name: l.name,
    total: l.total,
  });
  const ranking = (r: SnapshotDoReport['kills'][string]['rankingsDps'][number]) => ({
    name: r.name,
    server: { name: r.server.name },
    spec: r.spec,
    amount: r.amount,
    rankPercent: r.rankPercent,
    bracketPercent: r.bracketPercent,
  });
  const kills = Object.fromEntries(
    Object.entries(leitura.kills)
      .filter(([id]) => daRodada.has(Number(id)))
      .map(([id, k]) => [
        id,
        {
          damage: k.damage.map(linha),
          healing: k.healing.map(linha),
          dispels: {
            entries: k.dispels.entries.map((g) => ({
              ...(g.name === undefined ? {} : { name: g.name }),
              ...(g.entries === undefined
                ? {}
                : {
                    entries: g.entries.map((e) => ({
                      ...(e.name === undefined ? {} : { name: e.name }),
                      ...(e.details === undefined ? {} : { details: e.details.map(linha) }),
                    })),
                  }),
            })),
          },
          rankingsDps: k.rankingsDps.map(ranking),
          rankingsHps: k.rankingsHps.map(ranking),
        },
      ]),
  );

  // Os atores que alguém lê: quem morreu e quem está numa tabela por id.
  const citados = new Set<number>(deaths.map((d) => d.targetID));
  for (const k of Object.values(kills)) {
    for (const l of [...k.damage, ...k.healing]) citados.add(l.id);
    for (const g of k.dispels.entries) {
      for (const e of g.entries ?? []) for (const d of e.details ?? []) citados.add(d.id);
    }
  }
  const actors = leitura.actors
    .filter((a) => citados.has(a.id))
    .map((a) => ({ id: a.id, name: a.name, server: a.server }));

  return snapshotDoReportSchema.parse({
    versao: 1,
    code: leitura.code,
    title,
    revision: leitura.revision,
    startTime: leitura.startTime,
    fights,
    actors,
    deaths,
    kills,
  });
}

/** O snapshot gravado, como o cálculo lê — pelo schema, ou recusa. */
export function leituraDoSnapshot(gravado: unknown): LeituraDoReport {
  const s = snapshotDoReportSchema.parse(gravado);
  return {
    code: s.code,
    startTime: s.startTime,
    revision: s.revision,
    fights: s.fights,
    actors: s.actors,
    deaths: s.deaths,
    kills: Object.fromEntries(Object.entries(s.kills).map(([id, k]) => [Number(id), k])),
  };
}
