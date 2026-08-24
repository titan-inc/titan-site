-- Vaga de M+ anunciada no Discord (TIT-118).
--
-- A linha é gravada ANTES da entrega e o resultado é marcado depois — é o que
-- permite existir vaga cuja mensagem não chegou, em vez de perder o caso.
--
-- A tabela se apaga sozinha: um @Cron diário remove o que passou de 7 dias de
-- criação. Faxina, não retenção — nada aqui serve para ler ritmo de M+.

-- CreateTable
CREATE TABLE "MplusVaga" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tank" INTEGER NOT NULL,
    "healer" INTEGER NOT NULL,
    "dps" INTEGER NOT NULL,
    "quando" TIMESTAMP(3) NOT NULL,
    "keyMin" INTEGER NOT NULL,
    "keyMax" INTEGER NOT NULL,
    "semLust" BOOLEAN NOT NULL DEFAULT false,
    "semBrez" BOOLEAN NOT NULL DEFAULT false,
    "observacao" TEXT,
    "entregue" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MplusVaga_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MplusVaga_quando_idx" ON "MplusVaga"("quando");

-- CreateIndex
CREATE INDEX "MplusVaga_created_at_idx" ON "MplusVaga"("created_at");

-- AddForeignKey
ALTER TABLE "MplusVaga" ADD CONSTRAINT "MplusVaga_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
