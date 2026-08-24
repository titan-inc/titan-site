-- O dado do cliente do WoW, versionado por build — TIT-137.
--
-- VERSIONAR EXISTE PARA A VIRADA DE PATCH DEIXAR DE SER EVENTO AO VIVO.
-- Prepara do PTR antes, confere, e na virada troca o ponteiro do build ativo.
-- Deu errado, troca de volta — instantâneo, sem regerar nada.
--
-- O `WowItem` NÃO ganha coluna nenhuma aqui, e isso é estrutural: ele guarda
-- curadoria humana (`primaryStats`, `usableBySpecs`) e `WowItemSpec` tem
-- ON DELETE CASCADE. Com o db2 morando em `WowItemData`, o carregador não tem
-- o que escrever na tabela com curadoria.

-- ---------------------------------------------------------------------------
-- O `WowBonus` antigo é APAGADO, com os dados.
--
-- Ele era o dicionário curado à mão da TIT-82, com `kind` singular. Medido no
-- build 12.1.0: 19% dos bonus ids carregam MAIS DE UM significado (o 12825 é
-- track E qualidade E scale config), então o `kind` não conseguia representar
-- o que um bonus faz.
--
-- As linhas são integralmente regeneráveis pelo gerador (TIT-139) e nenhuma
-- tela lia esta tabela — `WowBonusService.decodificar` nunca teve rota. Migrar
-- as linhas antigas exigiria inventar um `buildId` para elas, criando um build
-- que nunca existiu.
-- ---------------------------------------------------------------------------

DROP TABLE "WowBonus";
DROP TYPE "WowBonusKind";

-- CreateEnum
CREATE TYPE "WowBonding" AS ENUM ('bind_on_pickup', 'bind_on_equip', 'warband', 'warbound_until_equipped');

-- CreateEnum
CREATE TYPE "WowScalingType" AS ENUM ('armor', 'weapon', 'trinket', 'jewelry');

-- CreateTable
CREATE TABLE "WowDataBuild" (
    "buildId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WowDataBuild_pkey" PRIMARY KEY ("buildId")
);

-- CreateTable
CREATE TABLE "WowItemData" (
    "buildId" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "itemLevel" INTEGER NOT NULL,
    "quality" INTEGER NOT NULL,
    "inventoryType" INTEGER NOT NULL,
    "material" INTEGER NOT NULL,
    "bonding" INTEGER NOT NULL,
    "flags" INTEGER[],
    "statIds" INTEGER[],
    "statAllocs" INTEGER[],
    "socketAllocs" INTEGER[],
    "itemDelay" INTEGER,
    "dmgVariance" DOUBLE PRECISION,
    "flavor" TEXT,
    "nameDescriptionId" INTEGER,
    "budgetIndex" INTEGER NOT NULL,
    "scalingType" "WowScalingType" NOT NULL,
    "armorModifier" DOUBLE PRECISION,
    "effects" JSONB,

    CONSTRAINT "WowItemData_pkey" PRIMARY KEY ("buildId","itemId")
);

-- CreateTable
CREATE TABLE "WowBonus" (
    "buildId" TEXT NOT NULL,
    "bonusId" INTEGER NOT NULL,
    "trackName" TEXT,
    "trackRank" INTEGER,
    "trackMaxRank" INTEGER,
    "trackScalingId" INTEGER,
    "itemLevel" INTEGER,
    "tertiary" "WowBonusTertiary",
    "hasSocket" BOOLEAN NOT NULL DEFAULT false,
    "binding" "WowBonding",
    "difficulty" TEXT,
    "difficultyColor" INTEGER,
    "quality" INTEGER,

    CONSTRAINT "WowBonus_pkey" PRIMARY KEY ("buildId","bonusId")
);

-- CreateTable
CREATE TABLE "WowItemContextBonus" (
    "buildId" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "itemContext" INTEGER NOT NULL,
    "bonusId" INTEGER NOT NULL,

    CONSTRAINT "WowItemContextBonus_pkey" PRIMARY KEY ("buildId","itemId","itemContext","bonusId")
);

-- CreateTable
CREATE TABLE "WowItemLevelScaling" (
    "buildId" TEXT NOT NULL,
    "itemLevel" INTEGER NOT NULL,
    "budget" DOUBLE PRECISION[],
    "damageReplaceStat" DOUBLE PRECISION NOT NULL,
    "damageSecondary" DOUBLE PRECISION NOT NULL,
    "crMult" DOUBLE PRECISION[],
    "stamMult" DOUBLE PRECISION[],
    "socketCost" DOUBLE PRECISION NOT NULL,
    "armorTotal" DOUBLE PRECISION[],
    "armorQuality" DOUBLE PRECISION[],
    "armorShield" DOUBLE PRECISION[],
    "dmgOneHand" DOUBLE PRECISION[],
    "dmgTwoHand" DOUBLE PRECISION[],
    "dmgOneHandCaster" DOUBLE PRECISION[],
    "dmgTwoHandCaster" DOUBLE PRECISION[],

    CONSTRAINT "WowItemLevelScaling_pkey" PRIMARY KEY ("buildId","itemLevel")
);

-- CreateIndex
CREATE INDEX "WowDataBuild_active_idx" ON "WowDataBuild"("active");

-- DOIS BUILDS ATIVOS AO MESMO TEMPO MISTURARIAM DADO EM SILÊNCIO, que é
-- exatamente a classe de falha que a pesquisa da TIT-136 persegue. O índice
-- parcial torna o estado impossível no banco, em vez de confiar em quem
-- escreve o UPDATE.
--
-- Não dá para expressar no schema.prisma (o Prisma não tem índice parcial),
-- então vive aqui — e some se alguém regerar esta migration a partir do
-- schema. Está no comentário do campo `active` também, por isso.
CREATE UNIQUE INDEX "WowDataBuild_um_ativo_so" ON "WowDataBuild"("active") WHERE "active";

-- CreateIndex
CREATE INDEX "WowItemData_itemId_idx" ON "WowItemData"("itemId");

-- CreateIndex
CREATE INDEX "WowBonus_bonusId_idx" ON "WowBonus"("bonusId");

-- CreateIndex
CREATE INDEX "WowItemContextBonus_buildId_itemId_itemContext_idx" ON "WowItemContextBonus"("buildId", "itemId", "itemContext");

-- AddForeignKey
ALTER TABLE "WowItemData" ADD CONSTRAINT "WowItemData_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "WowDataBuild"("buildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WowItemData" ADD CONSTRAINT "WowItemData_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WowItem"("itemId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WowBonus" ADD CONSTRAINT "WowBonus_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "WowDataBuild"("buildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WowItemContextBonus" ADD CONSTRAINT "WowItemContextBonus_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "WowDataBuild"("buildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WowItemLevelScaling" ADD CONSTRAINT "WowItemLevelScaling_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "WowDataBuild"("buildId") ON DELETE CASCADE ON UPDATE CASCADE;
