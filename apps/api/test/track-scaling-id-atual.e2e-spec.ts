import '../src/load-env'; // PRIMEIRO import — PrismaService lê DATABASE_URL na construção.
import { PrismaService } from '../src/prisma/prisma.service';
import { WowDataRepository } from '../src/wow-data/wow-data.repository';

/**
 * A prova contra o banco da Regra 3 do tooltip (TIT-135): a contagem
 * `rank/de` da track só pode ser impressa quando `trackScalingId` do bônus
 * é a season CORRENTE do build — `MAX(WowBonus.trackScalingId)`.
 *
 * `docs/db2-do-cliente.md` ("Quando a linha aparece") registra a regra
 * assim: `ItemGroupIlvlScalingID` é 11 no grupo 612 (cinto/anel, track
 * Myth) e 12 nos grupos 614/616 (ombro/colar) — e só os últimos mostram a
 * contagem no tooltip real. Este teste confere que o MESMO padrão aparece
 * nos bonus ids do build carregado, usando `WowDataRepository` (o caminho
 * de produção), não uma query solta.
 *
 * Os itens que carregam esses bônus (`Relentless Rider's Chain`,
 * `Platinum Star Band`, `Steelbark Shoulderguards`) são de temporada
 * anterior a Midnight S1 e não estão no catálogo (TIT-142) — por isso a
 * prova é pelo BONUS ID direto, via `facetasDeBonus`, não por
 * `WowItemStatsService.calcular` (que dependeria do item catalogado).
 * `WowBonus` é carregado por build inteiro, não filtrado pelo catálogo, e
 * os bonus ids continuam lá independente do item estar catalogado.
 *
 * PrismaService instanciado DIRETO — Regra 8: nunca `NestFactory`.
 *
 * Exige: build ativo carregado (`docs/ops.md`) e Postgres de dev no ar.
 */
describe('Regra 3 do tooltip — trackScalingId contra a season corrente do build', () => {
  let prisma: PrismaService;
  let repo: WowDataRepository;
  let buildAtivo: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    repo = new WowDataRepository(prisma);

    const ativo = await repo.buildAtivo();
    if (ativo === null) throw new Error('nenhum build ativo — ver docs/ops.md');
    buildAtivo = ativo;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('MAX(trackScalingId) do build bate com trackScalingIdAtual()', async () => {
    const atual = await repo.trackScalingIdAtual(buildAtivo);
    expect(atual).not.toBeNull();
  });

  it("grupo 612 (Myth, cinto/anel — Relentless Rider's Chain, Platinum Star Band): NÃO é a season corrente", async () => {
    // Bonus 12806 — mesmo id que o `docs/db2-fixture-de-itens.json` registra
    // para os dois espécimes, com a nota explícita: "Track da season
    // passada: o bônus 12806 existe mas a linha de upgrade NÃO aparece."
    const [facetas] = await repo.facetasDeBonus(buildAtivo, [12806]);
    const atual = await repo.trackScalingIdAtual(buildAtivo);

    expect(facetas?.trackName).toBe('Myth');
    expect(facetas?.trackScalingId).not.toBeNull();
    expect(facetas?.trackScalingId).not.toBe(atual);
  });

  it('grupo 614 (Adventurer, ombro — Steelbark Shoulderguards): É a season corrente', async () => {
    // Bonus 12817..12822 — os seis ranks do espécime, do
    // `docs/db2-fixture-de-itens.json` ("Track inteira de seis ranks").
    const bonusIds = [12817, 12818, 12819, 12820, 12821, 12822];
    const facetas = await repo.facetasDeBonus(buildAtivo, bonusIds);
    const atual = await repo.trackScalingIdAtual(buildAtivo);

    expect(facetas).toHaveLength(6);
    for (const f of facetas) {
      expect(f.trackName).toBe('Adventurer');
      expect(f.trackScalingId).toBe(atual);
    }
  });

  it('a diferença entre os dois grupos é exatamente o que decide a linha aparecer ou não', async () => {
    const [doCinto] = await repo.facetasDeBonus(buildAtivo, [12806]);
    const [doOmbro] = await repo.facetasDeBonus(buildAtivo, [12817]);

    expect(doCinto?.trackScalingId).not.toBe(doOmbro?.trackScalingId);
  });
});
