-- WowBonus: dicionário `bonusId -> significado` — TIT-82.
--
-- Carregado por POST /internal/ops/bonus-load, a partir de um arquivo obtido
-- e curado à mão do wago.tools (ver docs/ops.md). `kind` decide quais das
-- colunas nuláveis abaixo têm valor.

-- CreateEnum
CREATE TYPE "WowBonusKind" AS ENUM ('track', 'tertiary', 'socket');

-- CreateEnum
CREATE TYPE "WowBonusTertiary" AS ENUM ('avoidance', 'leech', 'speed', 'indestructible');

-- CreateTable
CREATE TABLE "WowBonus" (
    "bonusId" INTEGER NOT NULL,
    "kind" "WowBonusKind" NOT NULL,
    "trackName" TEXT,
    "trackRank" INTEGER,
    "trackMaxRank" INTEGER,
    "tertiary" "WowBonusTertiary",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WowBonus_pkey" PRIMARY KEY ("bonusId")
);
