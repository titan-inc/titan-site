-- Três coisas que a pesquisa resolveu e que não chegavam ao banco — TIT-141.
--
-- O sintoma comum: o gerador CONFERIA números que ele não EMITIA. Os "199/199"
-- da auto-conferência incluíam valores que a app nunca conseguiria produzir,
-- o que é pior que lacuna conhecida — parece cobertura.

-- ---------------------------------------------------------------------------
-- 1. Os stats que um bônus acrescenta, com o VALOR
--
-- `tertiary` era um enum único e sai. Medido no build 12.1.0: o `Type 2`
-- acrescenta QUALQUER stat, e quase sempre DOIS de uma vez — 740 listas com
-- dois, 270 com um, 12 com três, 1 com quatro. Os mais comuns são secundários
-- (Versatility em 468 listas, Haste 372, Mastery 368, Crit 353) contra 8 de
-- cada terciário. Enum singular era o mesmo erro do antigo `kind`.
--
-- Fica no BÔNUS e não no item porque o terciário é sorteado no drop: o
-- ItemSparse do Relentless Rider's Crown traz [74, 7, 36, 49], sem leech — o
-- leech vem do bonus 41 (`Type 2 = "62,3000"`). No item, todo drop daquele
-- elmo mostraria leech, inclusive os que não têm.
-- ---------------------------------------------------------------------------

-- 2. O desempate de item level
--
-- Duas listas do mesmo itemString podem disputar o ilvl. No Ancient Amani
-- Greataxe, 13844 traz "449,1" (ilvl 256) e 13845 traz "450,0" (ilvl 263, o
-- que o tooltip mostra) — o 0 vence. Sem o marcador as duas linhas ficam
-- indistinguíveis e o resolvedor acerta por ordem de iteração, que é sorte.
--
-- Cru, não booleano: um espécime não prova o enum inteiro do campo.

-- AlterTable
ALTER TABLE "WowBonus" DROP COLUMN "tertiary",
ADD COLUMN     "itemLevelMarcador" INTEGER,
ADD COLUMN     "statAllocs" INTEGER[],
ADD COLUMN     "statIds" INTEGER[];

-- DropEnum
DROP TYPE "WowBonusTertiary";

-- ---------------------------------------------------------------------------
-- 3. Set
--
-- Resolvido na pesquisa desde a PR #89 e nunca persistido: sem coluna, sem
-- emissão, e a auto-conferência pulava a chave em silêncio porque ela não é
-- número. Três espécimes da fixture trazem set e nenhum foi verificado por
-- caminho nenhum.
--
-- Volume pequeno: dos 975 itens do catálogo, 9 pertencem a set, em 3
-- conjuntos. Peça de tier em geral não dropa — dropa o token, que não tem
-- ItemSet.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "WowItemData" ADD COLUMN "itemSetId" INTEGER;

-- CreateTable
CREATE TABLE "WowItemSet" (
    "buildId" TEXT NOT NULL,
    "itemSetId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "pieceItemIds" INTEGER[],
    "bonuses" JSONB NOT NULL,

    CONSTRAINT "WowItemSet_pkey" PRIMARY KEY ("buildId","itemSetId")
);

-- AddForeignKey
ALTER TABLE "WowItemSet" ADD CONSTRAINT "WowItemSet_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "WowDataBuild"("buildId") ON DELETE CASCADE ON UPDATE CASCADE;
