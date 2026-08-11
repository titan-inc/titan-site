-- Opções de resposta: tabela configurável, mais as seis defaults do jogador e a
-- do loot master.
--
-- As linhas entram AQUI, e não num `prisma db seed` separado, por um motivo
-- prático: `prisma migrate deploy` já é o comando que alguém roda no deploy, e um
-- segundo passo de seed é um passo que dá para esquecer. Sem as opções a sessão
-- ao vivo não tem o que oferecer, e o import do histórico não tem para onde
-- traduzir.
--
-- `ON CONFLICT DO NOTHING` na slug: rodar de novo não duplica e não sobrescreve
-- `label` que alguém já editou na tela.

-- CreateEnum
CREATE TYPE "LootResponseKind" AS ENUM ('player', 'loot_master');

-- CreateTable
CREATE TABLE "LootResponseOption" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "LootResponseKind" NOT NULL DEFAULT 'player',
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LootResponseOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LootResponseOption_slug_key" ON "LootResponseOption"("slug");

-- CreateIndex
CREATE INDEX "LootResponseOption_active_position_idx" ON "LootResponseOption"("active", "position");

-- Defaults.
--
-- `position` em passos de 10 para caber opção nova entre duas sem renumerar a
-- lista — e reordenar não pode nunca mexer no slug, que é a identidade.
--
-- `banking` é `loot_master` porque é decisão sobre o destino do item, não
-- interesse de alguém: o RCLootCouncil o marca com `isAwardReason=true`, e era o
-- único rótulo assim nos 445 registros do export.
INSERT INTO "LootResponseOption" ("id", "slug", "label", "kind", "position", "updated_at")
VALUES
    ('seed_resp_bis',      'bis',      'BiS',      'player',      10, CURRENT_TIMESTAMP),
    ('seed_resp_upgrade',  'upgrade',  'Upgrade',  'player',      20, CURRENT_TIMESTAMP),
    ('seed_resp_minor',    'minor',    'Minor',    'player',      30, CURRENT_TIMESTAMP),
    ('seed_resp_offspec',  'offspec',  'Offspec',  'player',      40, CURRENT_TIMESTAMP),
    ('seed_resp_transmog', 'transmog', 'Transmog', 'player',      50, CURRENT_TIMESTAMP),
    ('seed_resp_pass',     'pass',     'Pass',     'player',      60, CURRENT_TIMESTAMP),
    ('seed_resp_banking',  'banking',  'Banking',  'loot_master', 70, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
