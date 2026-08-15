-- Participantes da sessão: quem está na raid, e com qual personagem.
--
-- Até aqui o único vestígio de uma pessoa numa sessão era a resposta, então o
-- sistema sabia quem respondeu e não sabia quem estava lá. As duas coisas são
-- diferentes, e a segunda é informação para quem decide: silêncio de quem estava
-- na raid não é o mesmo que ausência.
--
-- O `roll` fica nulável no mesmo passo. A linha de `noop` — silêncio de quem
-- estava na sessão — não tem roll, e zero apareceria na tela ao lado de quem
-- rolou 1 parecendo um roll ruim em vez da ausência de roll. Lacuna nunca vira
-- zero (Regra 7).
--
-- O valor `sistema` do enum entra aqui e é USADO na migration seguinte, de
-- propósito: Postgres não deixa usar valor de enum recém-criado na mesma
-- transação que o criou.

-- AlterEnum
ALTER TYPE "LootResponseKind" ADD VALUE 'sistema';

-- AlterTable
ALTER TABLE "LootSessionResponse" ALTER COLUMN "roll" DROP NOT NULL;

-- CreateTable
CREATE TABLE "LootSessionParticipant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "battletag" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "realmKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LootSessionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LootSessionParticipant_sessionId_idx" ON "LootSessionParticipant"("sessionId");

-- CreateIndex
-- Uma participação por pessoa por sessão: trocar de personagem atualiza a linha,
-- não cria outra. Ninguém raida em dois chars ao mesmo tempo.
CREATE UNIQUE INDEX "LootSessionParticipant_sessionId_userId_key" ON "LootSessionParticipant"("sessionId", "userId");

-- AddForeignKey
ALTER TABLE "LootSessionParticipant" ADD CONSTRAINT "LootSessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LootSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
