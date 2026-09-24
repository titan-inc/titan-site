# Titan Bet — Test Design (TDD, etapa RED)

> **Status: DESENHO, revisão 2 (23/09/2026).** Baseada em `docs/specs/titan-bet.md`
> (revisão 8). Nenhum teste do Titan Bet foi escrito, e nenhuma implementação existe. O
> processo é o da D-40: `Specification → Test Design → RED → Implementation → GREEN →
Refactor`, com as regras de RED da §5 (sem RED fabricado).
>
> Identificadores: **T-xx** são testes; **R-xx / D-xx / OQ-xx** são da spec.

---

## 1. Onde cada tipo de teste roda

### 1.1 O que o repositório tem hoje (inspecionado em 23/09/2026)

| Camada                          | Runner                                                                                                              | Banco?             | CI?     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------ | ------- |
| domínio (funções puras no Nest) | Jest, `apps/api/src/**/*.spec.ts` (`jest` em `apps/api/package.json`, `rootDir: src`)                               | não                | **sim** |
| contrato (schemas Zod)          | Vitest, `packages/shared`                                                                                           | não                | **sim** |
| service / API com Nest testing  | Jest, `apps/api/src/**/*.spec.ts` (precedentes: `session.guard.spec.ts`, `auth.controller.spec.ts`)                 | não, com fakes     | **sim** |
| "e2e" de banco                  | Jest, `apps/api/test/jest-e2e.json` (`*.e2e-spec.ts`) — instanciam `PrismaService` direto e leem o **banco de dev** | dev, compartilhado | **não** |

Fatos que decidem o desenho do banco de teste:

- **Um único `DATABASE_URL`**, no `.env` da raiz, lido por dois caminhos: o CLI do Prisma
  (`apps/api/prisma.config.ts`, com `dotenv` apontando para `../../.env`) e o runtime
  (`apps/api/src/load-env.ts` → `PrismaService`, que exige a variável e usa o adapter
  `PrismaPg`). O `dotenv` **não sobrescreve** variável que já está no ambiente — é o que
  permite apontar um processo para outro banco sem tocar no `.env`.
- **Um único banco** no `docker-compose.yml`: `postgres:18-alpine`, usuário/senha/banco
  `titan`, porta 5432.
- **CI sem banco**: `.github/workflows/ci.yml` declara um `DATABASE_URL` descartável só
  para o `prisma generate`, e roda `pnpm test` (que não inclui os `*.e2e-spec.ts`).
- **Nesta máquina, hoje, não há Postgres acessível**: porta 5432 recusando conexão e
  Docker Desktop parado. O `scripts/db.ps1` (`pnpm db:*`) assume Docker dentro do WSL
  Ubuntu, `pwsh` instalado e um caminho de repositório de outra máquina; aqui não roda.
  Para quem usa Docker Desktop, o próprio script diz que basta `docker compose up -d`.

### 1.2 Desenho do `titan_test` (aprovado; implementação é o RED-M2A)

| Aspecto                  | Desenho                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| banco                    | `titan_test`, no **mesmo** container Postgres do `docker-compose.yml`. Criado pelo setup do runner (`CREATE DATABASE` se não existir, conectando no banco `postgres`), porque o `docker-entrypoint-initdb.d` só roda em volume novo                                                                                                                                                                                                                                                                                                                                                                                                     |
| configuração             | variável **própria**, `TEST_DATABASE_URL`, documentada no `.env.example` com o valor local de exemplo (mesmo padrão do `DATABASE_URL` local). Nunca derivada do `DATABASE_URL`. O `.env` de cada pessoa não é tocado: quem for rodar acrescenta a linha                                                                                                                                                                                                                                                                                                                                                                                 |
| como os processos a usam | o setup do runner copia `TEST_DATABASE_URL` para `DATABASE_URL` **no ambiente do processo** antes de qualquer import; como o `dotenv` não sobrescreve, o `load-env.ts` e o `prisma.config.ts` passam a ver o banco de teste sem nenhuma mudança neles                                                                                                                                                                                                                                                                                                                                                                                   |
| proteção                 | antes de conectar, o setup falha se `TEST_DATABASE_URL` não existir, se o nome do banco não for exatamente `titan_test`, se o host não for local (`localhost`/`127.0.0.1`, ou o host do service container no CI), ou se for igual ao `DATABASE_URL` do `.env`                                                                                                                                                                                                                                                                                                                                                                           |
| schema                   | no início de cada execução: conferência pelo servidor (`current_database()` = `titan_test`), `DROP SCHEMA public CASCADE` + `CREATE SCHEMA public`, e **`prisma migrate deploy`** — o comando do deploy de produção. `DROP` não é bloqueado pelos triggers de append-only, que vigiam `UPDATE`/`DELETE`/`TRUNCATE`. **Desvio da revisão 2:** o desenho dizia `prisma migrate reset --force`; o CLI do Prisma recusa comandos destrutivos quando detecta um agente de IA e exige consentimento explícito de uma pessoa para liberar. Recriar o schema na mão, depois da guarda, dá o mesmo resultado sem pedir para contornar essa trava |
| isolamento               | por dado: cada teste cria a **sua** `BetRound` (`period` único) e seus dados. Nada de `TRUNCATE` entre testes — o ledger não permite, por desenho                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| tempo                    | dados reais: `cutoffAt` no futuro ou no passado, conforme o cenário. **Nenhum** bypass, relógio especial ou `NODE_ENV === 'test'` dentro de trigger                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| runner                   | `apps/api/test/jest-db.json`, arquivos `*.db-spec.ts` em `apps/api/test/db/`, script `test:db` em `apps/api` e na raiz. `PrismaService` instanciado direto (Regra 8), `--runInBand`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| fora do `pnpm test`      | o `pnpm test` da raiz continua sem banco, como o CI de hoje. O `test:db` é separado até o CI ter o banco                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CI (depois)              | service container `postgres:18-alpine` no job, `TEST_DATABASE_URL` apontando para ele, e um passo `pnpm test:db`. Decisão de quando ligar fica para depois do RED-M2A                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 2. Classificação dos mecanismos

Cada invariante vai para **um** mecanismo principal — o mais simples e mais forte. Defesa
em profundidade só com motivo escrito na coluna "Mecanismo".

| Mecanismo        | Usado para                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| FK / FK composta | pertencer à mesma rodada; alvo no snapshot com a role; bettor no snapshot                                                                  |
| UNIQUE           | uma rodada por period; uma Bet por slip/mercado; um bettor/candidato por rodada                                                            |
| UNIQUE parcial   | um slip ativo por conta; uma Weekly por rodada; uma auditoria confirmada; idempotência do ledger                                           |
| CHECK            | stake; forma da Bet; campos por estado; kind × encounter; role × tipo                                                                      |
| trigger          | configuração e snapshots congelados; slip só com rodada aberta; transições; Bet só em rascunho; resultado confirmado imutável; append-only |
| regra de domínio | cálculos, fases da rodada, algoritmos de resultado, self-bet, posse de personagem                                                          |
| transação        | Ready atômico; submit; confirmar depósito + lançamento; pagar                                                                              |
| autorização      | Officer Panel; dado privado só do dono; bettor do snapshot                                                                                 |

---

## 3. Matriz

Colunas: **Spec** · **Comportamento** · **Camada / tipo** · **Setup → Ação → Esperado** ·
**Mecanismo** · **RED esperado** · **Dependência** · **Automatizável agora?**

"Agora?/Automatizável" = sim (não precisa de banco); "infra-DB" = depois do RED-M2A;
"OQ-xx" = só depois da decisão; "manual" = não automatizável. O milestone de cada caso
está na §7.

### 3.1 Rodada e Ready

| T     | Spec             | Comportamento                                                     | Camada / tipo        | Setup → Ação → Esperado                                                                                                                                              | Mecanismo                            | RED esperado                         | Dependência                                             | Agora?   |
| ----- | ---------------- | ----------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------ | ------------------------------------------------------- | -------- |
| T-R01 | D-31             | apostar antes do Ready é impossível                               | banco / integração   | rodada sem `readyAt` → inserir slip → erro                                                                                                                           | trigger `titanbet_slip_aberto`       | insert aceito pelo schema estrutural | —                                                       | infra-DB |
| T-R02 | D-31, D-36       | só officer executa Ready                                          | API / autorização    | sessão de membro → `POST …/ready` → 403; sem cookie → 401                                                                                                            | `OfficerGuard`                       | planejado no milestone de API (§5.3) | —                                                       | sim      |
| T-R03 | D-31             | configuração imutável depois do Ready                             | banco / integração   | rodada com `readyAt` → insert/update/delete em `BetMarket` e `BetRoundEncounter` → erro                                                                              | trigger `titanbet_config_congelada`  | escrita aceita                       | —                                                       | infra-DB |
| T-R04 | D-32, D-38       | Ready grava bettors = personagens do roster, **sem exigir login** | service / integração | fake de roster Blizzard fresco com 3 personagens, só 1 com conta → Ready → 3 `BetRoundBettor`                                                                        | transação + domínio                  | aguarda seam (§5.1)                  | fake Blizzard                                           | infra-DB |
| T-R05 | D-33             | Ready grava candidates com role                                   | service / integração | fake WoWAudit com Heal/Melee/Tank → Ready → 3 `BetRoundCandidate` com as roles                                                                                       | transação                            | idem                                 | fake WoWAudit                                           | infra-DB |
| T-R06 | D-31             | Ready atômico: falha não grava nada                               | service / integração | WoWAudit `stale` / roster `stale` / lista vazia / config inválida → Ready → erro; rodada sem `readyAt`, 0 snapshots, `BetEvent` de falha                             | transação + validação de frescor     | idem                                 | fakes; sinal `stale` no `WowAuditService` (§12 da spec) | infra-DB |
| T-R07 | D-31             | Ready depois do cutoff é recusado                                 | banco + domínio      | rodada com `cutoffAt` passado → marcar `readyAt` → erro                                                                                                              | CHECK `readyAt < cutoffAt`           | update aceito                        | —                                                       | infra-DB |
| T-R08 | D-31             | Ready sem dia fixo                                                | domínio / unit       | relógio em sexta, sábado, segunda, terça 11:59:59 → `podeDarReady` = true; terça 12:00:00 → false                                                                    | função de fase                       | aguarda seam (§5.1)                  | —                                                       | sim      |
| T-R09 | D-32, D-33       | nada redefine os snapshots                                        | banco / integração   | rodada pronta → insert/update/delete em bettor e candidate → erro                                                                                                    | trigger `titanbet_snapshot_imutavel` | escrita aceita                       | —                                                       | infra-DB |
| T-R10 | D-38             | primeiro login depois do Ready associa, não altera                | service / integração | snapshot com personagem X sem conta → criar conta com `GuildCharacter` de X → abrir slip → aceito; contagem de bettors inalterada                                    | domínio + FK do slip                 | aguarda seam (§5.1)                  | —                                                       | infra-DB |
| T-R11 | D-38             | conta sem personagem no snapshot não aposta                       | service / integração | conta com personagem fora do snapshot → abrir slip → recusado                                                                                                        | domínio + FK                         | idem                                 | —                                                       | infra-DB |
| T-R12 | §16.5            | fases derivadas da rodada                                         | domínio / unit       | combinações de `readyAt`, relógio, auditorias, closing report → `PREPARATION`, `NAO_ABERTA`, `OPEN`, `BETTING_CLOSED`, `AUDITING`, `CALCULATED`, `SETTLED`, `CLOSED` | função de fase                       | aguarda seam (§5.1)                  | —                                                       | sim      |
| T-R13 | §16.4            | uma rodada por period                                             | banco                | duas rodadas com o mesmo `period` → erro                                                                                                                             | UNIQUE                               | insert aceito                        | —                                                       | infra-DB |
| T-R14 | R-22/R-24, §16.4 | boss de progressão só com First Death; Weekly sem boss e única    | banco                | mercado `top_dps` em encounter `progressao` → erro; Weekly com encounter → erro; duas Weekly → erro                                                                  | CHECK + UNIQUE parcial               | insert aceito                        | —                                                       | infra-DB |

### 3.2 Slip e apostas

| T     | Spec       | Comportamento                                                            | Camada / tipo               | Setup → Ação → Esperado                                                                                                  | Mecanismo                                                                                                                                      | RED esperado                                                                  | Dependência                                                                              | Agora?                      |
| ----- | ---------- | ------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------- |
| T-S01 | D-27       | Salvar cria o slip e depois reusa o mesmo                                | service / integração        | rodada aberta → Salvar 2× → 1 slip, `rascunho`                                                                           | domínio                                                                                                                                        | aguarda seam (§5.1)                                                           | —                                                                                        | infra-DB                    |
| T-S02 | D-34       | no máximo um slip **ativo** por conta                                    | banco                       | `rascunho`+`rascunho` → erro; `aguardando`+`rascunho` → erro; `recusado`+`rascunho` → ok; 2 `recusado` + 1 `valido` → ok | UNIQUE parcial                                                                                                                                 | insert aceito                                                                 | —                                                                                        | infra-DB                    |
| T-S03 | D-27       | Submeter congela total e depositante                                     | service / integração        | rascunho com 2 apostas → Submeter → `aguardando_deposito`, `expectedTotal` = Σ stakes, `submittedAt`                     | transação                                                                                                                                      | aguarda seam (§5.1)                                                           | —                                                                                        | infra-DB                    |
| T-S04 | D-27       | slip submetido não edita                                                 | banco                       | slip `aguardando_deposito` → insert/update/delete em `Bet` e `BetWeeklySelection` → erro                                 | trigger `titanbet_aposta_editavel`                                                                                                             | escrita aceita                                                                | —                                                                                        | infra-DB                    |
| T-S05 | D-34       | recusado é terminal                                                      | banco                       | slip `recusado` → mudar para `rascunho`/`valido`/`aguardando` → erro                                                     | trigger `titanbet_slip_transicao`                                                                                                              | update aceito                                                                 | —                                                                                        | infra-DB                    |
| T-S06 | D-34, D-35 | novo slip depois da recusa só antes do cutoff                            | banco                       | recusado + cutoff futuro → novo slip ok; recusado + cutoff passado → erro                                                | UNIQUE parcial + trigger `slip_aberto`                                                                                                         | insert aceito                                                                 | —                                                                                        | infra-DB                    |
| T-S07 | D-35       | cutoff encerra criar, editar e submeter                                  | banco                       | `cutoffAt` passado → criar slip / editar aposta de rascunho / submeter → erro                                            | triggers                                                                                                                                       | escrita aceita                                                                | —                                                                                        | infra-DB                    |
| T-S08 | D-35       | job de cutoff expira pendente e rascunho, preserva válido, é idempotente | service / integração        | um de cada estado → job 2× → `expirado`/`expirado`/`valido`/`recusado`                                                   | transação                                                                                                                                      | aguarda seam (§5.1)                                                           | —                                                                                        | infra-DB                    |
| T-S09 | D-28       | uma Bet por slip e mercado                                               | banco                       | duas Bets no mesmo mercado → erro                                                                                        | UNIQUE                                                                                                                                         | insert aceito                                                                 | —                                                                                        | infra-DB                    |
| T-S10 | D-28       | escolha simples = exatamente um alvo; Weekly sem alvo                    | banco                       | `top_dps` sem alvo → erro; Weekly com alvo → erro                                                                        | CHECK                                                                                                                                          | insert aceito                                                                 | —                                                                                        | infra-DB                    |
| T-S11 | D-28, D-15 | Weekly com 0, 1 e N bosses; boss de outra rodada ou não marcado → erro   | banco                       | Weekly sem seleção → ok; 3 seleções → ok; encounter de outra rodada → erro; `inWeeklyProgression=false` → erro           | FK composta + CHECK                                                                                                                            | insert aceito                                                                 | —                                                                                        | infra-DB                    |
| T-S12 | D-04, D-33 | alvo precisa ser candidato, na role do tipo                              | banco                       | alvo fora do snapshot → erro; `Heal` em `top_dps` → erro; `Melee` em `top_hps` → erro; `Tank` em `top_dispels` → ok      | FK composta + CHECK                                                                                                                            | insert aceito                                                                 | —                                                                                        | infra-DB                    |
| T-S13 | R-16       | stake inteiro de 200 a 1.000                                             | contrato / unit **e** banco | 199, 1.001, 200,5 → recusados; 200 e 1.000 → aceitos                                                                     | schema Zod (form + pipe, Regra 2) + CHECK — duas camadas porque o schema protege a entrada e o CHECK protege qualquer outro caminho de escrita | aguarda seam do contrato (Zod) / insert aceito pelo schema estrutural (CHECK) | —                                                                                        | sim (Zod); infra-DB (CHECK) |
| T-S14 | §16.3      | nada cruza rodadas                                                       | banco                       | Bet de slip da rodada X em mercado da rodada Y → erro                                                                    | FK composta                                                                                                                                    | insert aceito                                                                 | —                                                                                        | infra-DB                    |
| T-S15 | D-09       | self-bet em First Death proibido; em Top DPS permitido                   | domínio / unit              | alvo = personagem depositante em `first_death` → recusado; em `top_dps` → aceito                                         | domínio                                                                                                                                        | aguarda seam (§5.1)                                                           | a regra completa depende da OQ-27a; o caso "depositante" é proibido em qualquer resposta | sim (caso depositante)      |
| T-S16 | D-02, D-38 | depositante e personagem de elegibilidade pertencem à conta              | domínio / unit              | personagem de outra conta → recusado                                                                                     | domínio (`GuildCharacter`)                                                                                                                     | aguarda seam (§5.1)                                                           | —                                                                                        | sim                         |
| T-S17 | §16.4      | campos obrigatórios por estado                                           | banco                       | `valido` sem `validatedAt` → erro; `recusado` sem motivo → erro; `aguardando` sem `expectedTotal` → erro                 | CHECK                                                                                                                                          | update aceito                                                                 | —                                                                                        | infra-DB                    |
| T-S18 | §10        | concorrência: dois submits; submit × cutoff                              | service / integração        | duas transações simultâneas → uma vence, a outra recebe "já submetido"/"cutoff"                                          | `UPDATE … WHERE status` + trigger                                                                                                              | ambas passam                                                                  | —                                                                                        | infra-DB                    |

### 3.3 Depósito

| T     | Spec        | Comportamento                                     | Camada / tipo        | Setup → Ação → Esperado                                                                     | Mecanismo                         | RED esperado                         | Dependência               | Agora?   |
| ----- | ----------- | ------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------ | ------------------------- | -------- |
| T-D01 | D-36        | DTO de depósito sem escolhas                      | contrato / unit      | schema do DTO de officer → não tem campos de aposta, alvo, stake por aposta                 | schema Zod                        | aguarda seam do contrato (§5.5)      | OQ-48 não muda este teste | sim      |
| T-D02 | R-15, §16.6 | confirmar → `valido` + `deposito_validado` juntos | service / integração | slip `aguardando` → confirmar → status, `validatedBy/At` e 1 lançamento com `expectedTotal` | transação                         | aguarda seam (§5.1)                  | —                         | infra-DB |
| T-D03 | D-34        | recusar grava officer, horário e motivo           | service / integração | slip `aguardando` → recusar → `recusado`, campos preenchidos, nenhum lançamento             | transação                         | idem                                 | OQ-54 (restituição) fora  | infra-DB |
| T-D04 | D-07, D-35  | confirmar/recusar só antes do cutoff              | banco                | `cutoffAt` passado → confirmar → erro                                                       | trigger `titanbet_slip_transicao` | update aceito                        | —                         | infra-DB |
| T-D05 | D-36        | membro não confirma nem recusa                    | API / autorização    | sessão de membro → rotas de confirmar/recusar → 403                                         | `OfficerGuard`                    | planejado no milestone de API (§5.3) | —                         | sim      |

### 3.4 Odds / projected payout

| T     | Spec         | Comportamento                                        | Camada / tipo        | Setup → Ação → Esperado                                                                           | Mecanismo         | RED esperado                    | Dependência | Agora?   |
| ----- | ------------ | ---------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------- | ----------- | -------- |
| T-O01 | R-35, D-12   | `projected = floor(9V/10) / S(o)`; "—" se `S(o) = 0` | domínio / unit       | V e S de exemplo → multiplicador esperado; opção sem aposta → nulo                                | domínio           | aguarda seam (§5.1)             | —           | sim      |
| T-O02 | D-12         | só apostas `valido` contam                           | service / integração | stakes em slips `rascunho`, `aguardando`, `recusado`, `expirado` e `valido` → só os válidos somam | consulta agregada | aguarda seam (§5.1)             | —           | infra-DB |
| T-O03 | D-36, §16.10 | resposta de odds sem dado individual                 | contrato / unit      | schema publicado de odds → sem `userId`, slip, stake individual                                   | schema Zod        | aguarda seam do contrato (§5.5) | —           | sim      |
| T-O04 | OQ-55        | odds da Weekly Progression                           | —                    | —                                                                                                 | —                 | —                               | OQ-55       | OQ-55    |

### 3.5 Rateio (domínio puro)

| T     | Spec       | Comportamento                                         | Setup → Ação → Esperado                                                                                                                     | RED esperado        | Agora? |
| ----- | ---------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------ |
| T-M01 | §8.2       | exemplo da spec                                       | V = 3.450, vencedoras 700 e 300 → 2.173 e 931, resíduo 1, guilda 346                                                                        | aguarda seam (§5.1) | sim    |
| T-M02 | D-10       | propriedades do arredondamento                        | tabela de casos gerados deterministicamente → Σ payout ≤ P; Σ payout + guilda = V; resíduo < nº de vencedoras; resultado independe da ordem | idem                | sim    |
| T-M03 | R-20, §8.3 | empate soma todas as opções vencedoras no denominador | duas opções vencedoras → `W` = soma das duas                                                                                                | idem                | sim    |
| T-M04 | D-06       | `VOID` devolve stake integral e não gera receita      | mercado anulado → restituição = stakes; guilda 0                                                                                            | idem                | sim    |
| T-M05 | §8.2       | todo mundo na mesma opção recebe menos que apostou    | V inteiro numa opção → cada payout ≈ 90% do stake                                                                                           | idem                | sim    |
| T-M06 | D-10       | `P = floor(9V/10)` quando V não é múltiplo de 10      | V = 1.001 → P = 900                                                                                                                         | idem                | sim    |

Camada de todos: domínio / unit. Mecanismo: domínio. Dependência: nenhuma.

### 3.6 Ledger

| T     | Spec       | Comportamento                                                | Camada / tipo        | Setup → Ação → Esperado                                                                                                      | Mecanismo                      | RED esperado        | Dependência           | Agora?   |
| ----- | ---------- | ------------------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------- | --------------------- | -------- |
| T-L01 | D-37, D-39 | append-only no Postgres                                      | banco                | lançamento existente → UPDATE → erro; DELETE → erro; TRUNCATE → erro                                                         | trigger `titanbet_append_only` | comando aceito      | —                     | infra-DB |
| T-L02 | §16.4      | forma dos lançamentos                                        | banco                | `amount ≤ 0` fora de `ajuste` → erro; `ajuste` sem motivo/referência/ator → erro; `membro` sem slip → erro                   | CHECK                          | insert aceito       | —                     | infra-DB |
| T-L03 | §16.4      | idempotência                                                 | banco                | 2 `premio` para a mesma Bet → erro; 2 `deposito_validado` no mesmo slip → erro; 2 `receita_guilda` no mesmo resultado → erro | UNIQUE parcial                 | insert aceito       | —                     | infra-DB |
| T-L04 | §16.6      | saldo devido = créditos − pagamentos                         | domínio / unit       | lista de lançamentos → saldo esperado                                                                                        | domínio                        | aguarda seam (§5.1) | —                     | sim      |
| T-L05 | §16.6      | pagar = inserir `pagamento` do saldo; concorrente paga zero  | service / integração | saldo 500 → dois pagamentos simultâneos → um de 500, o outro recusado por saldo zero                                         | transação + lock do slip       | ambos gravam        | —                     | infra-DB |
| T-L06 | D-11       | pago nunca é reescrito; correção é `ajuste` + novo pagamento | service / integração | pago → ajuste +100 → saldo 100 → novo `pagamento`; o primeiro intacto                                                        | append-only + domínio          | aguarda seam (§5.1) | OQ-52 (negativo) fora | infra-DB |
| T-L07 | §16.6      | reconciliações                                               | service / integração | rodada liquidada → as três igualdades da §16.6                                                                               | domínio                        | idem                | —                     | infra-DB |

### 3.7 Auditar e fontes

| T     | Spec        | Comportamento                                                | Camada / tipo                | Setup → Ação → Esperado                                                                                                 | Mecanismo                             | RED esperado        | Dependência                        | Agora?   |
| ----- | ----------- | ------------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------- | ---------------------------------- | -------- |
| T-A01 | D-18        | prefixo `titanbet` sem diferenciar maiúsculas                | domínio / unit               | `titanbet`, `TitanBet Tuesday`, `TITANBET raid`, `titanbet-09-23` → sim; `Titan bet`, `xtitanbet`, `bet titanbet` → não | domínio                               | aguarda seam (§5.1) | —                                  | sim      |
| T-A02 | D-19, D-23  | só terça e quinta                                            | domínio / unit               | report `titanbet` iniciado numa quarta → ignorado                                                                       | domínio                               | idem                | —                                  | sim      |
| T-A03 | D-26        | report que atravessa a meia-noite é da sessão em que começou | domínio / unit               | report de terça com fight às 00:40 de quarta → fight na sessão de terça                                                 | domínio                               | idem                | —                                  | sim      |
| T-A04 | D-30        | caminho feliz: 1 report por sessão, sem seleção manual       | service / integração         | fake WCL com 1 `titanbet*` na terça e 1 na quinta → Auditar → 2 fontes `automatica`, auditoria `pronta`                 | domínio + transação                   | aguarda seam (§5.1) | fake WCL                           | infra-DB |
| T-A05 | D-24        | report ausente: para, não calcula, não vira `{}`             | service / integração         | nenhum `titanbet*` na quinta → Auditar → `aguardando_revisao`, 0 resultados                                             | domínio                               | idem                | fake WCL; OQ-45 define a resolução | infra-DB |
| T-A06 | D-25        | vários candidatos: officer escolhe e fica registrado         | service / integração + banco | 2 `titanbet*` na terça → `ambigua`; officer escolhe → `escolha_officer` com officer e horário; sem officer → erro       | domínio + CHECK                       | idem                | fake WCL                           | infra-DB |
| T-A07 | §16.4       | uma auditoria confirmada por rodada                          | banco                        | segunda `confirmada` → erro                                                                                             | UNIQUE parcial                        | insert aceito       | —                                  | infra-DB |
| T-A08 | D-08, §16.4 | resultado confirmado imutável                                | banco                        | auditoria confirmada → update em resultado/fonte → erro                                                                 | trigger `titanbet_resultado_imutavel` | update aceito       | —                                  | infra-DB |
| T-A09 | D-30        | refazer a auditoria cria outra tentativa                     | service / integração         | auditoria calculada → Auditar de novo → nova tentativa; a anterior `substituida`, intacta                               | domínio                               | aguarda seam (§5.1) | fake WCL                           | infra-DB |
| T-A10 | D-22, §15.4 | `difficulty 5` de dungeon não entra                          | domínio / unit               | fights com encounter fora do catálogo de raid → descartadas                                                             | domínio (`toRaidPulls`)               | aguarda seam (§5.1) | —                                  | sim      |
| T-A11 | D-37        | sessão só `terca`/`quinta`, no máximo uma de cada            | banco                        | `session` inválida → erro; duas `terca` na mesma auditoria → erro                                                       | enum + UNIQUE                         | insert aceito       | —                                  | infra-DB |

### 3.8 Resultados (domínio puro, logs fictícios)

| T     | Spec        | Comportamento                                                  | Setup → Ação → Esperado                                                  | Dependência             | Agora?                  |
| ----- | ----------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------- | ----------------------- |
| T-F01 | D-29, R-22  | kill na terça **ou** na quinta resolve o mesmo mercado farm    | kill só na quinta → Top DPS resolvido pela quinta                        | —                       | sim                     |
| T-F02 | D-13        | só candidato vence; candidato ausente não produz métrica       | maior DPS de outsider → vence o maior entre candidatos                   | —                       | sim                     |
| T-F03 | §7.3        | parse ausente ≠ 0                                              | candidato sem parse → fora do resultado                                  | OQ-25 define qual parse | sim (regra de ausência) |
| T-F04 | D-06, D-16  | sem kill na semana → **proposta** de `VOID`                    | boss farm sem kill → resultado `anulado` com motivo, não confirmado      | —                       | sim                     |
| T-F05 | D-13, D-14  | First Death farm pula outsider; empate na mesma ms conta todos | mortes [outsider t0, A t1, B t1] → A e B                                 | —                       | sim                     |
| T-P01 | D-29        | First Death de progressão soma terça + quinta                  | terça A 3 / B 2, quinta A 1 / B 3 → B vence com 5                        | —                       | sim                     |
| T-P02 | D-13, D-14  | por try: pula outsider; empate exato conta todos               | try com [outsider, A, B mesma ms] → A e B ganham 1                       | —                       | sim                     |
| T-P03 | R-27        | empate na soma → vários vencedores                             | A 4, B 4 → A e B                                                         | —                       | sim                     |
| T-P04 | R-28a       | evidência guarda cada try, a sessão e o First Death            | resultado → lista de tries com sessão, timestamp e personagem(ns)        | —                       | sim                     |
| T-P05 | D-29        | nenhuma pull válida na semana → proposta de `VOID`             | sem pulls → `anulado`                                                    | —                       | sim                     |
| T-W01 | D-05        | Weekly vence só com conjunto igual                             | K = {A,B}: {A,B} vence; {A} e {A,B,C} perdem                             | —                       | sim                     |
| T-W02 | D-15        | `{}` vence só sem kill                                         | K = {} → `{}` vence; K = {A} → `{}` perde                                | —                       | sim                     |
| T-W03 | D-24, §7.3  | sessão sem fonte deixa K indeterminado, nunca `{}`             | quinta sem fonte → cálculo recusa afirmar K                              | —                       | sim                     |
| T-W04 | D-19, D-23  | kill fora de terça/quinta não entra                            | kill num sábado → fora de K                                              | —                       | sim                     |
| T-W05 | D-49        | K ∩ encounters da Weekly (ver §3.17)                           | —                                                                        | —                       | sim                     |
| T-F06 | §7.5, OQ-25 | valor de parse usado fica congelado e nunca é recalculado      | recalcular com parse "atual" diferente → resultado confirmado inalterado | —                       | infra-DB                |

Camada: domínio / unit (T-F06: service). Mecanismo: domínio. RED esperado: aguarda seam (§5.1).

### 3.9 Autorização e privacidade

| T     | Spec          | Comportamento                               | Camada / tipo     | Setup → Ação → Esperado                                                            | Mecanismo                    | RED esperado                            | Agora?   |
| ----- | ------------- | ------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------- | -------- |
| T-Z01 | D-36, Regra 5 | nenhuma rota do Officer Panel aceita membro | API / autorização | para **cada** rota do controller de officer: sem cookie → 401; membro → 403        | `OfficerGuard`               | planejado no milestone de API (§5.3)    | sim      |
| T-Z02 | D-21, D-36    | membro não lê slip de outro                 | API / autorização | membro A pede slip de B pelo id → 404/403, sem corpo                               | repository por `ownerUserId` | planejado no milestone de API (§5.3)    | infra-DB |
| T-Z03 | D-32, D-38    | conta fora do snapshot não aposta           | API / integração  | conta da guilda hoje, fora do snapshot → Salvar → 403                              | domínio + FK                 | idem                                    | infra-DB |
| T-Z04 | D-21, §16.7   | contrato publicado não carrega dado privado | contrato / unit   | schemas `published` são estritos e não têm stake, alvo de perdedor, slip, depósito | schema Zod                   | aguarda seam do contrato (§5.5)         | sim      |
| T-Z05 | §9.1          | `published` não importa `betting`           | contrato / unit   | análise dos imports do módulo publicado → nenhum import de `betting`               | estrutura do shared          | **guarda de regressão**, sem RED (§5.4) | sim      |
| T-Z06 | §16.10        | odds não expõem apostas                     | API               | resposta de odds → só multiplicadores (valida contra T-O03)                        | schema + consulta agregada   | planejado no milestone de odds (§5.3)   | infra-DB |

### 3.10 Closing Report

| T     | Spec  | Comportamento                         | Camada / tipo        | Setup → Ação → Esperado                                                                                                                   | Mecanismo           | RED esperado                            | Dependência                             | Agora?   |
| ----- | ----- | ------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------- | --------------------------------------- | -------- |
| T-C01 | D-21  | conteúdo certo, sem dado privado      | service / integração | rodada liquidada → relatório com mercados, vencedores, ganho por mercado, `VOID`, guilda e totais; validado pelo schema publicado estrito | domínio + schema    | aguarda seam (§5.1)                     | OQ-51 (como exibir) não muda o conteúdo | infra-DB |
| T-C02 | §16.7 | imutável; republicar gera versão nova | banco                | update em relatório → erro; segunda publicação → `version` 2                                                                              | trigger + UNIQUE    | update aceito                           | —                                       | infra-DB |
| T-C03 | §16.7 | gerado sem ler apostas                | service / unit       | o service de closing é construído **sem** dependência do repository de apostas (verificado pelo módulo)                                   | estrutura do módulo | **guarda de regressão**, sem RED (§5.4) | —                                       | sim      |

### 3.13 Casos acrescentados na revisão 2 da matriz

Cobrem o que as seções 8–22 do pedido de 23/09/2026 exigem e a revisão 1 não tinha.
Mesmas colunas; `BLOCKED BY OQ-xx` quando o resultado esperado depende de decisão aberta.

| T     | Spec               | Comportamento                                                                           | Camada / tipo        | Setup → Ação → Esperado                                                                                                      | Mecanismo                                         | RED esperado                                                    | Dependência           | Automatizável |
| ----- | ------------------ | --------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- | --------------------- | ------------- |
| T-R16 | §16.4              | um encounter por boss na rodada                                                         | banco                | mesmo `encounterId` duas vezes na rodada → erro; rodadas diferentes → ok                                                     | UNIQUE `(roundId, encounterId)`                   | insert aceito pelo schema estrutural                            | —                     | infra-DB      |
| T-R17 | R-22/R-24, §16.4   | `track` do mercado presente ⇔ encounter presente                                        | banco                | mercado de boss com encounter e `track` nulo → erro; mercado sem encounter com `track` → erro                                | CHECK `BetMarket_track_com_encounter`             | insert aceito — a FK composta MATCH SIMPLE não confere com NULL | —                     | infra-DB      |
| T-R18 | D-31, §16.2        | a rodada não desfaz o Ready nem move cutoff, abertura ou period                         | banco                | zerar ou reescrever `readyAt`; mudar `cutoffAt`/`opensAt`/`period` → erro                                                    | trigger `titanbet_rodada_imutavel`                | update aceito                                                   | —                     | infra-DB      |
| T-S23 | §16.5              | `valido` não muda de estado                                                             | banco                | válido → qualquer estado → erro                                                                                              | trigger `titanbet_slip_transicao`                 | update aceito                                                   | —                     | infra-DB      |
| T-S24 | D-27, §16.4        | o que o submit congela não muda                                                         | banco                | mudar total, depositante, data de submit, quem confirmou → erro                                                              | trigger `titanbet_slip_transicao` (escrita única) | update aceito                                                   | —                     | infra-DB      |
| T-S25 | §16.5              | rascunho não pula o "Submeter pagamento"                                                | banco                | rascunho → válido ou recusado → erro                                                                                         | trigger `titanbet_slip_transicao`                 | update aceito                                                   | —                     | infra-DB      |
| T-E01 | §16.4, §16.8, D-39 | `BetEvent` é append-only                                                                | banco                | UPDATE, DELETE e TRUNCATE de evento → erro                                                                                   | trigger `titanbet_append_only`                    | escrita aceita                                                  | —                     | infra-DB      |
| T-B08 | §16.4              | um personagem por snapshot de bettors                                                   | banco                | mesmo personagem duas vezes na rodada → erro                                                                                 | UNIQUE `(roundId, characterId)`                   | insert aceito pelo schema estrutural                            | —                     | infra-DB      |
| T-K03 | §16.4              | um personagem por snapshot de candidatos                                                | banco                | mesmo personagem duas vezes na rodada → erro                                                                                 | UNIQUE `(roundId, characterId)`                   | insert aceito pelo schema estrutural                            | —                     | infra-DB      |
| T-B01 | D-32, D-38         | personagem fora do roster no Ready não entra no snapshot                                | service / integração | roster fake com A e B; C fora → Ready → sem linha para C                                                                     | domínio                                           | aguarda seam (§5.1)                                             | fake Blizzard         | infra-DB      |
| T-B02 | D-32               | entrar na guilda depois do Ready não cria bettor                                        | service / integração | Ready; depois o fake passa a ter D → qualquer operação da rodada → nenhuma linha para D                                      | domínio (não existe caminho de refresh)           | aguarda seam (§5.1)                                             | fake Blizzard         | infra-DB      |
| T-B03 | D-32               | sair da guilda depois do Ready não apaga o histórico                                    | banco + service      | Ready com A; A sai (o `GuildCharacter` some) → linha de A em `BetRoundBettor` continua                                       | trigger de snapshot + ausência de cascata         | insert/delete aceito pelo schema estrutural                     | —                     | infra-DB      |
| T-B04 | D-38               | slip exige personagem de elegibilidade do snapshot da mesma rodada                      | banco                | slip com `eligibilityCharacterId` fora do snapshot, ou do snapshot de outra rodada → erro                                    | FK composta                                       | insert aceito pelo schema estrutural                            | —                     | infra-DB      |
| T-B05 | D-34, D-38         | conta com dois personagens elegíveis continua com um slip ativo                         | banco                | mesma conta, dois slips ativos por personagens diferentes → erro                                                             | UNIQUE parcial por conta                          | insert aceito pelo schema estrutural                            | —                     | infra-DB      |
| T-B06 | D-38               | rename/transfer entre o Ready e o primeiro login                                        | —                    | **limitação documentada**, não comportamento do M2                                                                           | —                                                 | —                                                               | —                     | não se aplica |
| T-B07 | D-32, D-36         | quem está no snapshot mas **saiu da guilda** depois do Ready ainda acessa a superfície? | API                  | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-56**  | OQ-56         |
| T-K01 | D-33               | a role congelada vale, mesmo se o WoWAudit mudar depois                                 | service / integração | Ready com A `Heal`; fake muda A para `Ranged` → apostar A em `top_hps` aceito, em `top_dps` recusado                         | FK composta com role + CHECK                      | aguarda seam (§5.1)                                             | fake WoWAudit         | infra-DB      |
| T-K02 | D-33               | participação no WCL não cria candidato                                                  | domínio / unit       | fights com outsider → lista de candidatos do mercado inalterada                                                              | domínio                                           | aguarda seam (§5.1)                                             | —                     | sim           |
| T-S19 | D-35               | `expirado` é terminal                                                                   | banco                | slip `expirado` → qualquer transição → erro                                                                                  | trigger `titanbet_slip_transicao`                 | update aceito                                                   | —                     | infra-DB      |
| T-S20 | OQ-04a             | depositar com personagem da guilda ainda não ligado à conta                             | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-04a** | OQ-04a        |
| T-S21 | OQ-27a             | self-bet com personagem da conta que não é o depositante                                | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-27a** | OQ-27a        |
| T-S22 | D-28               | Weekly tem exatamente um stake; não existe stake por boss                               | banco                | `BetWeeklySelection` não tem coluna de valor; a `Bet` Weekly tem `stake` NOT NULL                                            | forma do schema                                   | **guarda de regressão**, sem RED (§5.4)                         | —                     | infra-DB      |
| T-R15 | OQ-46              | Ready valida o `track` declarado contra o histórico do WCL                              | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-46**  | OQ-46         |
| T-D06 | OQ-28              | officer confirma o próprio slip                                                         | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-28**  | OQ-28         |
| T-Z07 | D-36               | officer acessa as operações do Officer Panel                                            | API / autorização    | sessão de officer → rotas administrativas → 2xx                                                                              | `OfficerGuard`                                    | planejado no milestone de API (§5.3)                            | —                     | sim           |
| T-Z08 | D-36               | bettor da rodada vê odds de todos os mercados publicados                                | API                  | sessão de bettor → odds → 200 com um multiplicador por opção                                                                 | autorização + consulta agregada                   | planejado no milestone de odds (§5.3)                           | —                     | infra-DB      |
| T-Z09 | OQ-48              | officer vê o conteúdo completo de apostas privadas                                      | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-48**  | OQ-48         |
| T-Z10 | OQ-56              | membro do site fora do snapshot vê mercados e odds?                                     | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-56**  | OQ-56         |
| T-A12 | D-30, §15.10       | referências usadas ficam congeladas                                                     | service / integração | auditoria grava `code`, `title`, `revision`, `startTime`; mudar o fake depois → recálculo da mesma tentativa usa as gravadas | domínio + tabela imutável depois de confirmada    | aguarda seam (§5.1)                                             | fake WCL              | infra-DB      |
| T-A13 | OQ-45              | resolução de sessão sem fonte                                                           | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-45**  | OQ-45         |
| T-A14 | OQ-39              | report `titanbet*` parcial                                                              | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-39**  | OQ-39         |
| T-A15 | OQ-40              | pull repetida no report oficial ou boss morto nas duas sessões                          | —                    | detectar e **pedir revisão** é certo; o que fazer depois é a OQ                                                              | —                                                 | —                                                               | **BLOCKED BY OQ-40**  | OQ-40         |
| T-F07 | D-29               | não existe mercado por noite                                                            | banco                | `BetMarket` não tem relação com sessão                                                                                       | forma do schema                                   | **guarda de regressão**, sem RED (§5.4)                         | —                     | infra-DB      |
| T-F08 | OQ-25              | vencedor de Top DPS/HPS Parse %                                                         | —                    | qual parse (variante, momento)                                                                                               | —                                                 | —                                                               | **BLOCKED BY OQ-25**  | OQ-25         |
| T-F09 | OQ-34              | candidato fora da role jogando off-spec: HPS/HPS parse contam                           | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-34**  | OQ-34         |
| T-M07 | D-12, §8.1         | settlement usa só apostas `valido`                                                      | service / integração | stakes em todos os estados → `V` = soma dos válidos                                                                          | domínio + consulta                                | aguarda seam (§5.1)                                             | —                     | infra-DB      |
| T-M08 | D-16               | nenhum lançamento de `VOID` antes da confirmação do officer                             | service / integração | auditoria calculada com mercado anulado → 0 `restituicao_anulado`; confirmar → lançamentos                                   | transação                                         | aguarda seam (§5.1)                                             | —                     | infra-DB      |
| T-M09 | OQ-50              | liquidação parcial                                                                      | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-50**  | OQ-50         |
| T-L08 | §16.6              | nenhum valor financeiro fora do ledger (além de V/P/W e `expectedTotal`)                | banco                | inspeção do schema: nenhuma coluna de "valor pago/devido" fora do `GoldLedgerEntry`                                          | forma do schema                                   | **guarda de regressão**, sem RED (§5.4)                         | —                     | infra-DB      |
| T-L09 | OQ-52              | saldo negativo depois de ajuste                                                         | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-52**  | OQ-52         |
| T-L10 | OQ-54              | restituição de slip recusado com depósito real                                          | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-54**  | OQ-54         |
| T-L11 | OQ-03              | quem saiu da guilda com slip `valido` recebe                                            | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-03**  | OQ-03         |
| T-C04 | OQ-51              | identidade exibida do vencedor                                                          | —                    | —                                                                                                                            | —                                                 | —                                                               | desbloqueado (D-48)   | OQ-51         |
| T-X01 | OQ-30              | avisos no Discord                                                                       | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-30**  | OQ-30         |

### 3.14 Casos da revisão 9 da spec (D-43 a D-46)

**Preparação da semana (D-45)** — Officer Panel, antes do Ready.

| T     | Spec        | Comportamento                                                        | Camada               | Setup → Ação → Esperado                                                                                                | Mecanismo                            | RED esperado        | Agora?   |
| ----- | ----------- | -------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------- | -------- |
| T-G01 | D-45, §5.1  | criar a rodada da próxima semana                                     | domínio + service    | agora sexta → rodada com `period` = corrente + 1, `cutoffAt` na terça seguinte 12:00 no fuso, `opensAt` na sexta 00:00 | domínio (calendário) + banco         | aguarda seam (§5.1) | infra-DB |
| T-G02 | §16.2       | uma rodada por period                                                | service              | criar duas vezes → a segunda é recusada, nada muda                                                                     | unique `period`                      | aguarda seam        | infra-DB |
| T-G03 | D-22        | encounter só do catálogo de raid do WCL; nome e zona vêm do catálogo | service              | id fora do catálogo → recusado; do catálogo → gravado com `encounterName` e `zoneName` do WCL                          | domínio                              | aguarda seam        | infra-DB |
| T-G04 | D-29, §16.4 | progressão aceita só First Death; farm aceita os seis de boss        | contrato + service   | progressão com Top DPS → recusado; farm com os seis → aceito                                                           | Zod + domínio (+ CHECK do banco)     | aguarda seam        | sim      |
| T-G05 | D-45        | Weekly: um mercado por rodada e os encounters marcados               | service              | Weekly ligada com dois bosses marcados → um mercado `weekly_progression`, `inWeeklyProgression` só nos dois            | domínio + índice parcial             | aguarda seam        | infra-DB |
| T-G06 | D-45        | salvar de novo substitui a configuração inteira                      | service              | tira um encounter, troca track e mercados de outro → só o novo estado existe; `updatedBy` registrado                   | domínio                              | aguarda seam        | infra-DB |
| T-G07 | D-31        | depois do Ready a preparação é recusada                              | service              | rodada pronta → salvar → recusado com motivo, configuração intacta                                                     | domínio + trigger `config_congelada` | aguarda seam        | infra-DB |
| T-G08 | §16.8       | cada salvamento vira `BetEvent` com o que mudou e o officer          | service              | salvar → evento `configuracao_salva` com encounters/mercados criados, alterados e removidos                            | domínio                              | aguarda seam        | infra-DB |
| T-G09 | D-45        | candidatos e bettors nunca são escolhidos à mão                      | contrato             | corpo com lista de personagens → recusado pelo schema estrito                                                          | Zod                                  | aguarda seam        | sim      |
| T-G10 | D-45, D-31  | preparar → Ready congela a configuração preparada e os snapshots     | service / integração | preparar pelo service → Ready com fontes falsas → snapshots gravados, configuração imutável                            | domínio + triggers                   | aguarda seam        | infra-DB |
| T-G11 | D-36        | rotas de preparação só para officer                                  | API / autorização    | cada rota: sem cookie → 401; membro → 403; officer → 2xx                                                               | `OfficerGuard`                       | planejado (§5.3)    | sim      |

**Redistribuição do `W = 0` (D-44)** — domínio puro, §8.6 da spec.

| T     | Spec | Comportamento                                                             | Setup → Ação → Esperado                                                                            | Agora? |
| ----- | ---- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------ |
| T-M10 | D-44 | órfão não é `VOID`: sem restituição; `G₀` fica com a guilda               | órfão com V 1.000 → nenhuma restituição, receita 100                                               | sim    |
| T-M11 | D-44 | `P` do órfão dividido igualmente entre os premiáveis; resto para a guilda | P 900, três premiáveis → +300 cada; P 1.000, três → +333 cada, resto 1                             | sim    |
| T-M12 | D-44 | o receptor rateia `P + cota` pelo stake das vencedoras                    | receptor com P 900 + cota 300 e W 600 → prêmios `floor(1.200 × stake / 600)`                       | sim    |
| T-M13 | D-44 | `VOID` e outro órfão não recebem; cada órfão reparte o seu                | dois órfãos, um VOID, dois premiáveis → só os dois premiáveis recebem, cada órfão dividido à parte | sim    |
| T-M14 | D-44 | sem mercado premiável para um órfão com `P > 0` → não liquida             | um órfão e um VOID → recusa com motivo, nenhum lançamento proposto                                 | sim    |
| T-M15 | D-44 | reconciliação da rodada fecha com redistribuição                          | casos gerados → Σ prêmios + receitas + restos = Σ V dos mercados não anulados                      | sim    |

**Parse % (D-43).** O congelamento no Auditar é o T-F06; a escolha do campo da API é o
gate #1 (§6), não teste.

### 3.15 Resultado persistido (§16.2, §16.4)

| T     | Spec        | Comportamento                                    | Setup → Ação → Esperado                                               | Mecanismo                             | RED esperado  | Agora?   |
| ----- | ----------- | ------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------- | ------------- | -------- |
| T-X01 | §16.3       | um resultado por mercado por tentativa           | segundo resultado do mesmo mercado na mesma auditoria → erro          | unique `(auditId, marketId)`          | insert aceito | infra-DB |
| T-X02 | §16.4       | auditoria, mercado e resultado da mesma rodada   | mercado ou auditoria de outra rodada → erro                           | FKs compostas com `roundId`           | insert aceito | infra-DB |
| T-X03 | §16.4       | desfecho coerente                                | anulado sem motivo, anulado com P/W, vencedores sem P/W, V < 0 → erro | CHECK                                 | insert aceito | infra-DB |
| T-X04 | D-13        | vencedor é candidato do snapshot                 | outsider ou candidato de outra rodada → erro                          | FK → `BetRoundCandidate`              | insert aceito | infra-DB |
| T-X05 | D-15        | kill da Weekly é encounter da rodada             | encounter de outra rodada → erro                                      | FK composta                           | insert aceito | infra-DB |
| T-X06 | D-43, T-F06 | resultado, vencedor e kill nunca mudam nem somem | UPDATE/DELETE → erro                                                  | trigger `titanbet_resultado_imutavel` | aceito        | infra-DB |
| T-X07 | D-30        | resultado só entra com a auditoria `pronta`      | auditoria em revisão, calculada, substituída ou confirmada → erro     | trigger                               | insert aceito | infra-DB |

### 3.16 Cálculo do Auditar (§7.3, D-43, D-47)

| T     | Spec             | Comportamento                                                                                                                          | Camada            | Setup → Ação → Esperado                                                        | RED esperado     | Agora?   |
| ----- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------ | ---------------- | -------- |
| T-W06 | D-47, Regra 6    | leitura do report: ator ↔ candidato por nome + realm; pulls na sessão do report; valor da tabela por métrica; dispels somados por ator | domínio / unit    | formato da API → pulls, valores e evidência                                    | aguarda seam     | sim      |
| T-W07 | D-47             | adaptador do WCL: as queries e a paginação das mortes                                                                                  | unit              | resposta simulada da API → leitura; ranking `Rankings/Today`                   | aguarda seam     | sim      |
| T-Q01 | §7.3             | calcula todos os mercados; auditoria `calculada`; V/P/W das apostas válidas                                                            | service + banco   | auditoria pronta → calcular → um resultado por mercado, vencedores do snapshot | aguarda seam     | infra-DB |
| T-Q02 | D-13, D-14, D-29 | First Death de farm e de progressão com dados de report                                                                                | service + banco   | mortes por try → vencedores e somas na evidência                               | aguarda seam     | infra-DB |
| T-Q03 | D-05             | Weekly: `K` gravado; `W` das apostas no conjunto exato                                                                                 | service + banco   | kills da semana → `K` e `W`                                                    | aguarda seam     | infra-DB |
| T-Q04 | D-43, T-F06      | Parse % congelado na evidência; recalcular recusado                                                                                    | service + banco   | parse muda no WCL → resultado igual                                            | aguarda seam     | infra-DB |
| T-Q05 | D-16, D-44       | proposta de VOID e `W = 0` ficam como resultado                                                                                        | service + banco   | sem kill → `anulado`; ninguém no vencedor → `W = 0`                            | aguarda seam     | infra-DB |
| T-Q06 | §7.2, OQ-40/47   | recusas sem gravar: auditoria não pronta, duas kills, boss fora da Weekly; só lê os reports congelados                                 | service + banco   | → `AuditoriaRecusada`, nada gravado                                            | aguarda seam     | infra-DB |
| T-Q07 | D-36             | rotas de calcular e ver resultados só para officer                                                                                     | API / autorização | sem cookie → 401; membro → 403; officer → 2xx                                  | planejado (§5.3) | sim      |

### 3.17 Casos da revisão 10 da spec (D-48 a D-51)

| T     | Spec | Comportamento                                                         | Camada             | Setup → Ação → Esperado                                                                       | RED esperado                           | Agora?   |
| ----- | ---- | --------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------- | -------- |
| T-W05 | D-49 | `K` = kills ∩ encounters da Weekly congelados no Ready                | domínio + service  | kill de boss configurado fora da Weekly e de boss fora da rodada → fora de `K`, cálculo segue | comportamento anterior (recusa)        | sim      |
| T-K04 | D-51 | role do snapshot decide o mercado; spec jogada não                    | service + banco    | candidato `Heal` com o maior dano da luta → fora do Top DPS, dentro do Top HPS                | **guarda de regressão** (já era assim) | infra-DB |
| T-L09 | D-50 | ajuste que deixaria saldo negativo é recusado                         | service + banco    | já coberto no T-L06; a decisão fecha a OQ-52                                                  | —                                      | infra-DB |
| T-C04 | D-48 | membro identificado pelo personagem de elegibilidade, nunca BattleTag | service + contrato | closing → nome e realm do personagem de elegibilidade; o JSON não contém BattleTag            | aguarda seam                           | infra-DB |
| T-C05 | D-48 | total devido agregado por membro/personagem                           | service + banco    | prêmio + restituição + ajuste da conta → um total por personagem                              | aguarda seam                           | infra-DB |

### 3.18 Revisão 11 da spec (D-53 a D-66) — o que muda na matriz

**Casos substituídos por mudança de produto.** A expectativa antiga deixa de valer porque a
decisão mudou — não é correção de teste. Cada um é reescrito com o id novo indicado, e o
teste antigo sai no mesmo commit que o novo entra.

| Antigo                                                         | O que exigia                                                     | Decisão | Substituído por                              |
| -------------------------------------------------------------- | ---------------------------------------------------------------- | ------- | -------------------------------------------- |
| T-W01, T-W02, T-W03, T-W05                                     | Weekly por conjunto exato, `{}`, `K` indeterminado, `K` ∩ Weekly | D-54    | T-W10–T-W13                                  |
| T-W04                                                          | kill fora de terça/quinta fora de `K`                            | D-54    | T-W12 (a mesma regra, por boss)              |
| T-S11, T-S22                                                   | Weekly com 0..N bosses, um stake para o conjunto                 | D-54    | T-W14                                        |
| T-G05 e o `inWeeklyProgression`                                | officer marca os bosses da Weekly                                | D-54    | T-W15 (progressão = opção)                   |
| T-R14 (parte "Weekly sem boss")                                | Weekly precisa de boss marcado                                   | D-54    | T-W16 (Weekly precisa de boss de progressão) |
| T-Q03, T-X05                                                   | `K` gravado; W por conjunto; kill ∈ encounters da rodada         | D-54    | T-W17 (bosses mortos = opções vencedoras)    |
| T-O04 (bloqueado) e o caso "Weekly fora das odds"              | Weekly sem odds                                                  | D-54    | T-W18                                        |
| T-F04, T-P05, o `sem_vencedor` do T-F02/T-F05, T-Q05 (1º caso) | "sem kill / sem pull / sem candidato" → proposta de VOID         | D-61    | T-M16–T-M18                                  |
| o caso "duas kills → revisão" (T-Q06, `killDaSemana`)          | recusar e pedir revisão                                          | D-62    | T-F08                                        |
| T-A06, T-A12 (escolha), CHECKs de `escolha_officer`/`ambigua`  | um report por sessão, o officer escolhe entre vários             | D-63    | T-A16–T-A18                                  |
| T-S16 (depositante da conta)                                   | depositante precisa ser `GuildCharacter` da conta                | D-55    | T-S26                                        |
| T-S15 (só o depositante)                                       | self-bet só no depositante                                       | D-56    | T-S27                                        |
| "conta fora do snapshot não vê odds" (odds)                    | 403 para quem não é bettor                                       | D-53b   | T-Z11                                        |
| membro sem roster → 403 nas rotas do membro                    | ex-membro barrado                                                | D-53a   | T-Z10                                        |

**Casos desbloqueados:** T-A13 (D-60) → T-A19; T-A14 (D-63) → T-A16; T-A15 (D-62/D-63) →
T-F08 e T-A18; T-S21 (D-56) → T-S27; T-Z09 (D-57); T-Z10 (D-53); T-B07 (D-53a) → T-Z10;
T-O04 (D-54) → T-W18; T-M09 (D-61: sem parcial) → T-M16.

**Casos novos:**

| T     | Decisão    | Comportamento                                                                                            | Camada             |
| ----- | ---------- | -------------------------------------------------------------------------------------------------------- | ------------------ |
| T-W10 | D-54       | só boss de **progressão** é opção da Weekly; farm fica fora                                              | domínio + banco    |
| T-W11 | D-54       | a aposta da Weekly escolhe **um** boss de progressão (uma aposta por mercado, D-28)                      | contrato + banco   |
| T-W12 | D-54       | boss de progressão morto em Mythic, em terça/quinta, é opção vencedora; vários mortos, vários vencedores | domínio            |
| T-W13 | D-54, D-61 | nenhum boss de progressão morto → Weekly sem resultado premiável                                         | domínio + service  |
| T-W14 | D-54       | aposta da Weekly tem alvo = encounter de progressão da rodada; farm ou outra rodada → erro               | banco              |
| T-W15 | D-54       | a preparação não marca bosses da Weekly: a Weekly usa os de progressão                                   | contrato + service |
| T-W16 | D-54       | Ready com Weekly e sem boss de progressão → recusado                                                     | service            |
| T-W17 | D-54       | cálculo e settlement da Weekly por boss: bosses mortos gravados; W = stake nos mortos                    | service + banco    |
| T-W18 | D-54       | odds da Weekly: um multiplicador por boss de progressão                                                  | service + contrato |
| T-F08 | D-62       | várias kills do mesmo boss → vale a primeira, cronologicamente                                           | domínio            |
| T-A16 | D-63       | todos os `titanbet*` da sessão são fonte, congelados; nada de escolha                                    | service + banco    |
| T-A17 | D-63       | pull duplicada entre reports conta uma vez (mesmo encounter, início absoluto < 10 s)                     | domínio            |
| T-A18 | D-62/63    | kill em dois reports: vale a primeira; valores lidos do report dessa cópia                               | domínio + service  |
| T-A19 | D-60       | officer declara "sem raid oficial" com motivo; sessão resolvida sem pulls; ausência sozinha não resolve  | service + banco    |
| T-M16 | D-61       | mercado sem resultado premiável: `G₀` para a guilda, `P` redistribuído; nenhuma restituição              | domínio + service  |
| T-M17 | D-61       | desfecho `sem_vencedor` no banco e nos contratos, com o motivo                                           | banco + contrato   |
| T-M18 | D-61       | nenhum caminho automático produz `anulado`                                                               | service            |
| T-S26 | D-55       | depositante: qualquer personagem informado (nome + realm), congelado no slip                             | contrato + service |
| T-S27 | D-56       | First Death em qualquer personagem reconhecido do apostador → recusado (Salvar e Submeter)               | service            |
| T-Z09 | D-57       | officer vê o slip como submetido, só leitura, e o acesso vira `BetEvent`                                 | API + service      |
| T-Z10 | D-53a      | ex-membro com slip na rodada acessa a própria rodada e aposta; nada fora dela                            | API + service      |
| T-Z11 | D-53b      | membro da guilda fora do snapshot vê mercados e odds; não salva nem submete                              | API + service      |

Sem teste, por decisão: D-58 (officer confirma o próprio depósito — o comportamento atual),
D-59 (recusado não restitui — o atual), D-64 (sem validação no WCL — o atual), D-65 (quem
sai continua concorrendo — o atual do cálculo e do settlement; o acesso é o T-Z10), D-66
(sem Discord).

**Milestones da revisão 11**, nesta ordem: (1) Weekly por boss e `sem_vencedor` (D-54,
D-61) — muda schema, contratos, cálculo e settlement juntos; (2) fontes da auditoria (D-60,
D-62, D-63); (3) depositante e self-bet (D-55, D-56); (4) acesso (D-53) e ver slip (D-57).

### 3.11 E2E (um fluxo, não a suíte inteira)

| T     | Fluxo                                                                                                             | Quando                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| T-E01 | Ready → Salvar → Submeter → confirmar depósito → cutoff → Auditar (fake WCL) → confirmar → pagar → closing report | depois do M9, com a infraestrutura de banco |

### 3.12 Fora da automação

| Item          | Natureza | Onde está                                  |
| ------------- | -------- | ------------------------------------------ |
| M0 #1, #2, #6 | manual   | gates antes de ligar settlement automático |

---

## 4. Testes bloqueados por OQ

Nenhum resultado esperado foi presumido. Estado das OQs conforme a spec, revisão 8.

| OQ     | Testes bloqueados                | Observação                                                                           |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------ |
| OQ-03  | T-L11                            |                                                                                      |
| OQ-04a | T-S20                            |                                                                                      |
| OQ-25  | T-F08; parte da T-F03 e da T-F06 | T-F03 testa só "parse ausente ≠ 0"; T-F06 testa só "valor gravado não é recalculado" |
| OQ-27a | T-S21                            | T-S15 cobre o caso "depositante", proibido em qualquer resposta                      |
| OQ-28  | T-D06                            |                                                                                      |
| OQ-30  | T-X01                            |                                                                                      |
| OQ-34  | T-F09                            |                                                                                      |
| OQ-39  | T-A14                            |                                                                                      |
| OQ-40  | T-A15                            | detectar e parar para revisão não depende da OQ                                      |
| OQ-45  | T-A13                            | T-A05 cobre só "para e não calcula"                                                  |
| OQ-46  | T-R15                            |                                                                                      |
| OQ-47  | T-W05                            |                                                                                      |
| OQ-48  | T-Z09                            | T-D01 cobre só o DTO de depósito, que não depende da OQ                              |
| OQ-50  | T-M09                            |                                                                                      |
| OQ-51  | T-C04                            | T-C01 cobre o conteúdo, que não depende da OQ                                        |
| OQ-52  | T-L09                            |                                                                                      |
| OQ-54  | T-L10                            |                                                                                      |
| OQ-55  | T-O04                            |                                                                                      |
| OQ-56  | T-B07, T-Z10                     | **nova** — ver a spec                                                                |

---

## 5. Como produzir RED — regras (revisão 2)

A revisão 1 desta seção propunha stubs que lançam "não implementado" e controllers sem
guard. **Os dois foram rejeitados** (não fabricar RED). As regras vigentes:

1. **Domínio.** Escrever o teste da interface desejada; introduzir só a estrutura mínima
   **legítima** que o torna executável — tipos e a assinatura que fazem parte natural do
   design —; rodar; observar falha **comportamental**; parar antes da implementação que
   daria GREEN. `throw new Error('not implemented')` **não** é usado como método. Quando
   não há como executar o teste sem implementar parte substancial da feature, o caso fica
   marcado **`RED awaiting implementation seam`** — o que a matriz chama de "aguarda seam"
   — e o RED é registrado no milestone em que a costura surge.
2. **Banco.** Migration incremental: (a) só o schema **estrutural** necessário para o
   teste conseguir inserir os dados; (b) o teste da invariante roda e o banco **aceita** a
   operação que deveria recusar — RED; (c) só então CHECK/FK/índice/trigger; (d) GREEN. A
   estrutura inicial é etapa real da implementação, não uma migration errada de
   propósito.
3. **Autorização.** Nenhum controller inseguro de propósito, nenhum `OfficerGuard`
   retirado. No milestone de API: o teste de autorização é escrito **antes** da rota; a
   primeira implementação da rota já nasce considerando o teste. Um 404 de rota
   inexistente não prova autorização — o RED fica planejado para esse momento ("planejado
   no milestone de API/odds").
4. **Guardas estruturais** (T-S22, T-F07, T-L08, T-Z05, T-C03) passam antes da feature.
   São **guardas de regressão**, declaradas assim, e **não** contam como evidência de RED.
5. **Testes de ausência de campo privado** (T-D01, T-O03, T-Z04) afirmam também os campos
   obrigatórios do contrato publicado; se ainda não houver contrato, o caso aguarda seam.
6. **Para chegar ao GREEN** não se enfraquece assertion, não se remove cenário, não se
   troca o esperado, não se pula teste e não se mocka a regra testada. Se a spec precisar
   mudar, para e registra antes.

---

## 6. Gates do M0 (não automatizáveis)

M0 #1 e #2 são gates **antes de ligar settlement automático em produção** (o #6 deixou de
ser gate na D-46). Não viram
teste artificial. Os testes abaixo usam logs **fictícios** e provam o algoritmo; o gate
prova que os números do WCL real batem com a tela.

| Gate   | O que falta                                                   | Testes cujo resultado em produção depende dele |
| ------ | ------------------------------------------------------------- | ---------------------------------------------- |
| #1     | comparação humana das seis métricas de farm com a tela do WCL | T-F01, T-F02, T-F08                            |
| #2     | comparação humana do First Death das tries com a tela do WCL  | T-F05, T-P01–T-P05                             |
| ~~#6~~ | não é mais gate (D-46): vale o parse disponível no Auditar    | —                                              |

---

## 7. Milestones TDD

Cada milestone RED termina com evidência revisada **antes** do GREEN correspondente.
GREENs não são adiantados.

| Milestone             | Conteúdo                                                                                                                                          | Testes                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **RED-M2A**           | infraestrutura: `titan_test`, proteção contra URL errada, runner `*.db-spec.ts`, um spec de sanidade da infra, baseline. **Não é RED funcional.** | sanidade: conecta no `titan_test`, recusa URL de dev, aplica migrations                                                                      |
| **RED-M2B**           | schema **estrutural** (models Prisma e migration só com tabelas, colunas, PK, enums e FK simples) + testes das invariantes centrais, rodando RED  | T-R07, T-R13, T-R14, T-R16, T-S02, T-S09, T-S10, T-S11, T-S12, T-S13 (CHECK), T-S14, T-S17, T-B04, T-B05, T-B08, T-K03; guardas T-S22, T-F07 |
| GREEN-M2B             | migration **só** com as invariantes: UNIQUE, índices parciais, FKs compostas, CHECKs                                                              | os mesmos                                                                                                                                    |
| **RED-M2C**           | imutabilidade no banco: configuração, snapshots, slip, ledger                                                                                     | T-R01, T-R03, T-R09, T-B03, T-S04, T-S05, T-S06, T-S07, T-S19, T-D04, T-L01, T-L02, T-L03, T-R18, T-S23, T-S24, T-S25; guarda T-L08          |
| GREEN-M2C             | triggers mínimas                                                                                                                                  | os mesmos                                                                                                                                    |
| RED/GREEN Ready       | workflow do Ready                                                                                                                                 | T-R04, T-R05, T-R06, T-R08, T-R10, T-R11, T-R12, T-B01, T-B02, T-K01, T-K02, T-E01                                                           |
| RED/GREEN Apostas     | Salvar, Submeter, depósito, cutoff                                                                                                                | T-S01, T-S03, T-S08, T-S13 (Zod), T-S15, T-S16, T-S18, T-D02, T-D03                                                                          |
| RED/GREEN Autorização | Officer Panel e dado privado                                                                                                                      | T-R02, T-D05, T-Z01, T-Z02, T-Z03, T-Z07, T-D01                                                                                              |
| RED/GREEN Odds        | projected payout                                                                                                                                  | T-O01, T-O02, T-O03, T-Z06, T-Z08                                                                                                            |
| RED/GREEN Auditar     | fontes e WCL                                                                                                                                      | T-A01–T-A12, T-Z05                                                                                                                           |
| RED/GREEN Preparação  | criar e preparar a semana no Officer Panel (D-45)                                                                                                 | T-G01–T-G11                                                                                                                                  |
| RED/GREEN Resultados  | farm, progressão, Weekly                                                                                                                          | T-F01–T-F06, T-P01–T-P05, T-W01–T-W04                                                                                                        |
| RED/GREEN Settlement  | rateio e ledger                                                                                                                                   | T-M01–T-M08, T-M10–T-M15, T-L04–T-L07                                                                                                        |
| RED/GREEN Closing     | relatório de fechamento                                                                                                                           | T-C01–T-C03                                                                                                                                  |
| E2E                   | um fluxo                                                                                                                                          | T-E01                                                                                                                                        |

Os casos **BLOCKED** (§4) entram no milestone da sua área quando a OQ for resolvida.

---

## 8. Baseline antes do primeiro RED (23/09/2026, `feat/titan-bet` em `0beccec`)

| Comando             | Resultado                                                                                                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`        | `packages/shared` e `apps/api` OK. **`apps/web` falhou** no type check por arquivo **gerado localmente** (`apps/web/.next/dev/types/validator.ts`, ignorado pelo git) que ainda referencia `app/oauth/callback/page.js`, removida na TIT-148. Não é código versionado; em clone limpo não existe. Não foi apagado |
| `pnpm test`         | **GREEN.** `packages/shared` 19 arquivos, **299** testes; `apps/api` 50 suítes, **680** testes; `apps/web` 19 arquivos, **147** testes. Total **1.126**, nenhum falho                                                                                                                                             |
| `test:e2e`          | **não executado**: sem Postgres acessível nesta máquina (§1.1). Não faz parte do CI                                                                                                                                                                                                                               |
| `pnpm format:check` | GREEN                                                                                                                                                                                                                                                                                                             |

Tudo o que falhar a partir do RED-M2A e não estiver nesta lista é Titan Bet.

---

## 9. RED-M2A — execução (23/09/2026)

**Status: concluído, aguardando revisão.** Infraestrutura, não RED funcional.

### 9.1 O que foi criado

| Arquivo                                      | Papel                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/api/test/db/guarda.ts`                 | função pura que só devolve uma URL se ela for o `titan_test` local e diferente do banco de dev     |
| `apps/api/test/db/ambiente.ts`               | lê o `.env` **sem carregá-lo**, passa pela guarda e aponta `DATABASE_URL` do processo para o teste |
| `apps/api/test/db/setup-env.ts`              | `setupFiles`: aplica o acima antes dos imports de cada spec                                        |
| `apps/api/test/db/global-setup.ts`           | guarda → cria o banco se faltar → confere pelo servidor → recria o schema → `migrate deploy`       |
| `apps/api/test/db/infraestrutura.db-spec.ts` | sanidade: 8 testes da guarda, 3 da conexão e do schema                                             |
| `apps/api/test/jest-db.json`                 | runner dos `*.db-spec.ts`                                                                          |
| `apps/api/package.json`, `package.json`      | script `test:db` (`--runInBand`), fora do `pnpm test`                                              |
| `.env.example`                               | `TEST_DATABASE_URL` documentada                                                                    |

Nenhum model, migration, trigger, service, controller ou teste funcional do Titan Bet. Os
scripts `db:*` não foram alterados.

### 9.2 Evidência de isolamento e proteção

| Execução                                           | Resultado                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm test:db` **sem** `TEST_DATABASE_URL`         | abortou no `globalSetup`: "TEST_DATABASE_URL não está definida"; nenhum banco criado            |
| `TEST_DATABASE_URL` = banco de dev (`…/titan`)     | abortou: "aponta para o banco \"titan\". Só \"titan_test\" é aceito"                            |
| `TEST_DATABASE_URL` com host remoto                | abortou: "Só host local é aceito"                                                               |
| `TEST_DATABASE_URL` = `…/titan_test` (1ª execução) | `titan_test` criado; 33 migrations aplicadas; **11/11 testes** GREEN                            |
| mesma, 2ª execução                                 | schema recriado sobre o banco existente; 33 migrations; **11/11** GREEN                         |
| banco de dev `titan`, antes × depois               | contagem exata de linhas das 14 tabelas + `_prisma_migrations` (11): **idênticas** (mesmo hash) |

### 9.3 Validações do CLAUDE.md

| Comando             | Resultado                                                                                                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check` | GREEN                                                                                                                                                                                                                                                                                                       |
| `pnpm build`        | shared e api OK; web falha pelo mesmo cache local do baseline (§8)                                                                                                                                                                                                                                          |
| `pnpm lint`         | **api OK** (inclui `test/db/`); **web falha** por dependência não ligada no `node_modules` desta máquina (`eslint-module-utils/resolve`, exigido pelo `eslint-plugin-import`). Não é código; nenhum arquivo do web ou lockfile mudou. Não fazia parte do baseline da §8 porque o lint não tinha sido rodado |
| `pnpm typecheck`    | **api OK** (inclui `test/db/`), shared OK; web falha pelo mesmo cache local                                                                                                                                                                                                                                 |
| `pnpm test`         | GREEN, **1.126** — igual ao baseline; nenhum `*.db-spec.ts` entra                                                                                                                                                                                                                                           |
| `pnpm test:db`      | GREEN, 11/11, só com `TEST_DATABASE_URL` válida                                                                                                                                                                                                                                                             |

### 9.4 Pendências, nenhuma de produto

- **CI**: ligar o `pnpm test:db` exige service container do Postgres — decisão
  separada, não feita aqui.
- **Ambiente desta máquina** (fora do Titan Bet): o cache `apps/web/.next/dev` desatualizado
  e a dependência de lint quebrada no `node_modules` do web.

---

## 10. RED-M2B — execução (23/09/2026)

**Status: RED registrado, aguardando revisão. GREEN-M2B não iniciado.**

### 10.1 O que foi criado

| Arquivo                                                          | Papel                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/prisma/schema.prisma`                                  | 8 models e 4 enums do Titan Bet, **só estrutura**; relações inversas em `Character`                                                                                                                      |
| `apps/api/prisma/migrations/20260923180000_titan_bet_estrutura/` | enums, tabelas, PKs e FKs simples para a entidade pai. **Nenhuma** UNIQUE, índice, CHECK ou FK composta. Gerada por `prisma migrate diff --from-schema <HEAD> --to-schema <novo>`, sem conectar em banco |
| `apps/api/test/db/titan-bet/escrita.ts`                          | traduz o SQLSTATE (`23505`/`23503`/`23514`) em `unique`/`fk`/`check`; escrita aceita = `aceito`; qualquer outra falha = `outro:…`, nunca contada como recusa                                             |
| `apps/api/test/db/titan-bet/fabrica.ts`                          | dado **válido** por estado; cada teste cria sua rodada (period aleatório) e seus personagens                                                                                                             |
| `apps/api/test/db/titan-bet/rodada-e-mercados.db-spec.ts`        | T-R13, T-R07, T-R16, T-R14; guarda T-F07                                                                                                                                                                 |
| `apps/api/test/db/titan-bet/snapshots-e-slip.db-spec.ts`         | T-B08, T-K03, T-B04, T-S02/T-B05, T-S17                                                                                                                                                                  |
| `apps/api/test/db/titan-bet/apostas.db-spec.ts`                  | T-S13, T-S09, T-S10, T-S12, T-S14, T-S11; guarda T-S22                                                                                                                                                   |

O SQLSTATE vem de `meta.driverAdapterError.cause.originalCode` (Prisma 7 + `adapter-pg`),
medido numa sonda descartável no `titan_test` antes dos testes.

### 10.2 Evidência

`pnpm test:db` no `titan_test` (34 migrations, incluindo a estrutural): **79 testes — 53
RED, 26 GREEN.**

- **Os 53 RED falham todos pelo mesmo motivo: `Received: "aceito"`** — o banco aceitou a
  escrita que a invariante proíbe. Esperados: 29 `check`, 11 `fk`, 13 `unique`. Nenhuma
  falha por fixture, import ou infraestrutura (`outro:` = 0).
- **Os 26 GREEN** são: 11 de infraestrutura (RED-M2A), 13 **controles positivos** (dado
  válido aceito — continuam verdes depois do GREEN e provam que as fixtures são boas) e 2
  **guardas de regressão** (T-F07, T-S22), que não contam como RED.

| Caso         | RED | Esperado no GREEN          |
| ------------ | --- | -------------------------- |
| T-R13        | 1   | unique                     |
| T-R07        | 2   | check                      |
| T-R16        | 1   | unique                     |
| T-R14        | 6   | check ×2, fk ×2, unique ×2 |
| T-B08, T-K03 | 2   | unique                     |
| T-B04        | 2   | fk                         |
| T-S02/T-B05  | 5   | unique                     |
| T-S17        | 10  | check                      |
| T-S13        | 4   | check                      |
| T-S09        | 2   | unique                     |
| T-S10        | 4   | check ×3, fk ×1            |
| T-S12        | 9   | fk ×3, check ×6            |
| T-S14        | 2   | fk                         |
| T-S11        | 3   | fk ×1, check ×2            |

### 10.3 Validações

`pnpm test` GREEN, **1.126** (igual ao baseline); `api` lint e typecheck OK;
`pnpm format:check` OK; banco de dev `titan` com o mesmo hash de antes.

### 10.4 Para o GREEN-M2B — o que os testes cobram

1. **Três casos acrescentados** (T-R16, T-B08, T-K03): as UNIQUE de encounter e dos dois
   snapshots estão na §16.4 da spec, mas não tinham teste na matriz. Sem eles, o GREEN
   criaria constraint sem RED.
2. **Mercado e encounter na mesma rodada.** O teste "mercado apontando para encounter de
   outra rodada" (T-R14) aplica o §16.3 ("nada cruza rodadas"). A §16.4 listava a FK
   composta do mercado só como `(roundEncounterId, track)`; para esse teste passar ela
   precisa incluir o `roundId`: `(roundEncounterId, roundId, track)` →
   `BetRoundEncounter(id, roundId, track)`. Não é regra nova — é a mesma FK com a coluna
   que o §16.3 já exige.
3. `200,5` (T-S13) não entra no teste de banco: a coluna é `Int` e o Prisma recusa antes
   de chegar ao Postgres. O "gold inteiro" da entrada fica no schema Zod, no milestone de
   Apostas.

---

## 11. GREEN-M2B — execução (23/09/2026)

**Status: GREEN, aguardando revisão. Nada de M2C ou comportamento funcional.**

### 11.1 O que foi feito

- `apps/api/prisma/schema.prisma`: os models do RED-M2B ganharam só invariantes —
  `@unique`/`@@unique` e as relações **compostas** no lugar das FKs simples que elas
  substituem (slip → snapshot de bettors; aposta → slip, mercado e candidato; mercado →
  encounter; seleção → aposta e encounter). `Character` perdeu duas relações inversas
  que passaram a chegar pelos snapshots.
- `apps/api/prisma/migrations/20260923190000_titan_bet_invariantes/`: parte gerada por
  `prisma migrate diff` (schema estrutural → schema com invariantes, sem conectar em
  banco) e, escritos à mão, 2 índices únicos parciais e 15 CHECKs.
- **Nenhum arquivo de teste foi alterado depois do RED**: os cinco arquivos de
  `test/db/titan-bet/` têm data de modificação anterior ao run que gerou a evidência RED.

### 11.2 Constraints implementadas

| Tipo           | Constraint                                                                                                                                                                                                             | Testes              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| UNIQUE         | `BetRound(period)`                                                                                                                                                                                                     | T-R13               |
| UNIQUE         | `BetRoundEncounter(roundId, encounterId)`                                                                                                                                                                              | T-R16               |
| UNIQUE         | `BetMarket(roundId, kind, roundEncounterId)`                                                                                                                                                                           | T-R14               |
| UNIQUE         | `BetRoundBettor(roundId, characterId)`, `BetRoundCandidate(roundId, characterId)`                                                                                                                                      | T-B08, T-K03        |
| UNIQUE         | `Bet(slipId, marketId)`                                                                                                                                                                                                | T-S09               |
| UNIQUE (alvo)  | `BetRoundEncounter(id, roundId, track)`, `(id, roundId, inWeeklyProgression)`; `BetMarket(id, roundId, kind)`; `BetRoundCandidate(roundId, characterId, role)`; `BetSlip(id, roundId)`; `Bet(id, roundId, marketKind)` | alvos das FKs       |
| UNIQUE parcial | `BetSlip_um_ativo_por_conta` — `(roundId, ownerUserId) WHERE status IN (rascunho, aguardando_deposito, valido)`                                                                                                        | T-S02, T-B05        |
| UNIQUE parcial | `BetMarket_uma_weekly_por_rodada` — `(roundId) WHERE kind = weekly_progression`                                                                                                                                        | T-R14               |
| FK composta    | `BetMarket(roundEncounterId, roundId, track)` → encounter                                                                                                                                                              | T-R14               |
| FK composta    | `BetSlip(roundId, eligibilityCharacterId)` → `BetRoundBettor(roundId, characterId)`                                                                                                                                    | T-B04               |
| FK composta    | `Bet(slipId, roundId)` → slip; `Bet(marketId, roundId, marketKind)` → mercado; `Bet(roundId, targetCharacterId, targetRole)` → candidato                                                                               | T-S10, T-S12, T-S14 |
| FK composta    | `BetWeeklySelection(betId, roundId, marketKind)` → aposta; `(roundEncounterId, roundId, inWeeklyProgression)` → encounter                                                                                              | T-S11               |
| CHECK          | `BetRound_ready_antes_do_cutoff`, `BetRound_ready_com_officer`                                                                                                                                                         | T-R07               |
| CHECK          | `BetMarket_weekly_sem_boss`, `BetMarket_progressao_so_first_death`                                                                                                                                                     | T-R14               |
| CHECK          | `BetSlip_submetido_completo`, `BetSlip_valido_com_officer`, `BetSlip_recusado_com_officer_e_motivo`, `BetSlip_expirado_com_data`, `BetSlip_total_positivo`                                                             | T-S17               |
| CHECK          | `Bet_stake_200_a_1000`                                                                                                                                                                                                 | T-S13               |
| CHECK          | `Bet_alvo_conforme_tipo`, `Bet_alvo_com_role`, `Bet_role_conforme_tipo`                                                                                                                                                | T-S10, T-S12        |
| CHECK          | `BetWeeklySelection_so_weekly`, `BetWeeklySelection_so_boss_marcado`                                                                                                                                                   | T-S11               |

### 11.3 Resultado

| Comando                                          | Resultado                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `pnpm test:db`                                   | **79/79** (35 migrations). Os **53 RED** do §10 passam, pelo nome; mesmo conjunto de testes nos dois runs |
| `pnpm test`                                      | **1.126**, igual ao baseline                                                                              |
| `api` lint, typecheck, build; `shared` typecheck | OK                                                                                                        |
| `pnpm format:check`                              | OK                                                                                                        |
| banco de dev `titan`                             | mesmo hash de antes; 11 migrations; nenhuma tabela `Bet*`                                                 |

### 11.4 Diferenças em relação à spec e pendências

1. **FK do mercado com `roundId`** — aprovada; a §16.4 da spec foi atualizada.
2. **Brecha do `track` — fechada em §11.5** (T-R17, RED → GREEN).
3. **`ON DELETE` das FKs compostas** ficou `RESTRICT`, o default do Prisma para elas.
   A FK simples `BetMarket → BetRoundEncounter` do estrutural era `SET NULL`; com a
   composta, apagar um encounter com mercados é recusado. Em `PREPARATION` isso obriga a
   remover os mercados antes do boss — coerente com o M2C, que trava a configuração.

### 11.5 Brecha do `track` do mercado — T-R17 (23/09/2026)

A FK composta `(roundEncounterId, roundId, track)` é MATCH SIMPLE: com uma coluna NULL,
não confere nada. Tratado em TDD, depois do commit do M2B e antes do M2C.

| Passo      | Resultado                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| teste      | arquivo **novo** `apps/api/test/db/titan-bet/mercado-track.db-spec.ts` — 2 casos; nenhum teste existente alterado                                                                                                         |
| RED        | 81 testes: **2 falham, ambos "esperado `check`, recebido `aceito`"**; 79 passam. O primeiro caso grava `top_dps` num boss de **progressão** com `track` nulo — a brecha deixava passar exatamente o que R-22/R-24 proíbem |
| GREEN      | migration `20260923200000_titan_bet_track_do_mercado`: um CHECK, `BetMarket_track_com_encounter` = `(roundEncounterId IS NULL) = (track IS NULL)`. **81/81**                                                              |
| validações | `pnpm test` 1.126; `api` lint, typecheck e build OK; `format:check` OK; banco de dev com o mesmo hash                                                                                                                     |

---

## 12. RED-M2C — execução (23/09/2026)

**Status: RED registrado; GREEN-M2C concluído (§12.5).**

### 12.1 O que foi criado

| Arquivo                                                                                 | Papel                                                                                                                                                                       |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/prisma/schema.prisma` + migration `20260923210000_titan_bet_ledger_estrutura` | `GoldLedgerEntry` **só estrutura**: enums de conta e tipo, tabela, FKs simples. `resultId` sem FK — o `BetMarketResult` nasce no milestone do Auditar                       |
| `apps/api/test/db/titan-bet/escrita.ts`                                                 | nova classe `trigger` (SQLSTATE `P0001`), medida numa sonda descartável: vem no mesmo campo em operação de model e em SQL cru                                               |
| `apps/api/test/db/titan-bet/ciclo.ts`                                                   | **novo**: monta dados na ordem do ciclo de vida (PREPARATION → configuração → snapshots → Ready → slips); `esperarPassar` espera o relógio **do Postgres** passar do cutoff |
| `apps/api/test/db/titan-bet/imutavel-config.db-spec.ts`                                 | T-R01, T-R03, T-R09, T-B03, T-R18                                                                                                                                           |
| `apps/api/test/db/titan-bet/imutavel-slip.db-spec.ts`                                   | T-S04, T-S05, T-S19, T-S23, T-S24, T-S25, T-S07, T-S06, T-D04                                                                                                               |
| `apps/api/test/db/titan-bet/ledger.db-spec.ts`                                          | T-L01, T-L02, T-L03; guarda T-L08                                                                                                                                           |

Casos novos, todos de regras já escritas na spec, que a matriz não tinha:

| T     | Spec                                                                          | Por quê                                                                 |
| ----- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| T-R18 | D-31, §16.2 (`cutoffAt` imutável, `readyAt` "escrito uma vez")                | sem ele, zerar o `readyAt` reabriria a configuração e desfaria o freeze |
| T-S23 | §16.5 (`valido` é final)                                                      | a matriz testava só recusado e expirado                                 |
| T-S24 | D-27 (o submit congela total e depositante), §16.4 (colunas escritas uma vez) | cobre o slip, não só as apostas                                         |
| T-S25 | §16.5 (transições)                                                            | rascunho não pode pular o "Submeter pagamento"                          |

### 12.2 Evidência

`pnpm test:db` (37 migrations): **122 testes — 31 RED, 91 GREEN.**

- **Os 31 RED falham todos por `Received: "aceito"`** — a escrita que a regra proíbe foi
  aceita. Esperados: 23 `trigger`, 5 `check`, 3 `unique`. Nenhuma falha por outro motivo.
- **91 GREEN** = os 81 anteriores + 9 controles positivos + a guarda T-L08.
- Os casos de cutoff levam alguns segundos: cada um cria uma rodada com cutoff 4 s à
  frente e espera o `now()` do Postgres passar.

### 12.3 Validações

`api` typecheck e lint OK; `pnpm test` e `format:check` conferidos antes do registro.

### 12.4 Conflito com a suíte M2B — resolvido por decisão de produto

Os triggers da §16.4 (aprovados na D-39) proíbem justamente a ordem em que os testes do
**M2B** montam seus dados:

| Trigger da spec                    | O que o M2B faz                                                              | Testes atingidos                       |
| ---------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| slip só com `readyAt` preenchido   | cria slip em rodada **sem** Ready (`f.rodada()` padrão)                      | T-B04, T-S02/T-B05, T-S17 — **22**     |
| snapshot só **antes** do Ready     | `cenarioDeAposta` cria a rodada já pronta e depois grava bettor e candidatos | todos de `apostas.db-spec.ts` — **27** |
| configuração só **antes** do Ready | cria encounter e mercado depois do `cenarioDeAposta`                         | idem                                   |

Com os triggers, esses testes passariam a falhar com `trigger` no lugar da `unique`/`fk`/
`check` que afirmam — não porque a regra deles mudou, mas porque a montagem do dado
viola outra regra. Não existe trigger correto que evite isso: a ordem do M2B é a que a
spec proíbe.

A correção é reordenar a **montagem** dos testes do M2B para o ciclo de vida (o
`ciclo.ts` já faz isso), **sem mudar nenhuma asserção nem resultado esperado**. Como a
regra vigente é não alterar testes existentes, a decisão fica com o produto.

**Decisão (23/09/2026):** reordenar **só a montagem** dos testes do M2B para o ciclo de
vida, sem mudar asserção nem resultado esperado. Feito:

- `fabrica.ts`: `pronta()` (o UPDATE do Ready) e `cenarioDeAposta` na ordem
  PREPARATION → configuração (callback) → snapshots → Ready → slip.
- `apostas.db-spec.ts`: encounters e mercados criados no callback, antes do Ready.
- `snapshots-e-slip.db-spec.ts`: Ready entre o snapshot e o slip; o segundo bettor do
  T-B05 gravado antes do Ready.
- **Prova de que só a montagem mudou:** comparadas com o commit do M2B, as linhas de
  asserção, os valores esperados e os títulos dos testes são idênticos nos quatro
  arquivos, e a contagem de `expect` é a mesma. Rodado antes das triggers, o estado da
  suíte ficou igual ao do RED-M2C: mesmos 91 GREEN e 31 RED, teste a teste.

### 12.5 GREEN-M2C

Migration `20260923220000_titan_bet_imutabilidade` — 7 triggers, 4 CHECKs e 3 índices
únicos parciais:

| Mecanismo                              | Tabela                                | Regra                                                                                                                                   | Testes                                          |
| -------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `titanbet_rodada_imutavel`             | `BetRound`                            | period, abertura e cutoff fixos; Ready escrito uma vez                                                                                  | T-R18                                           |
| `titanbet_config_congelada`            | `BetRoundEncounter`, `BetMarket`      | escrita só em PREPARATION                                                                                                               | T-R03                                           |
| `titanbet_snapshot_imutavel`           | `BetRoundBettor`, `BetRoundCandidate` | INSERT só antes do Ready; UPDATE/DELETE nunca                                                                                           | T-R09, T-B03                                    |
| `titanbet_slip_aberto`                 | `BetSlip` (INSERT)                    | só com Ready e antes do cutoff                                                                                                          | T-R01, T-S06, T-S07                             |
| `titanbet_slip_transicao`              | `BetSlip` (UPDATE)                    | só as transições da §16.5; submeter/confirmar/recusar antes do cutoff; campos de submit, validação, recusa e expiração escritos uma vez | T-S05, T-S19, T-S23, T-S24, T-S25, T-S07, T-D04 |
| `titanbet_aposta_editavel`             | `Bet`, `BetWeeklySelection`           | escrita só com o slip em rascunho e antes do cutoff                                                                                     | T-S04, T-S07                                    |
| `titanbet_append_only` (+ `_truncate`) | `GoldLedgerEntry`                     | UPDATE, DELETE e TRUNCATE recusados                                                                                                     | T-L01                                           |
| 4 CHECKs                               | `GoldLedgerEntry`                     | valor por tipo; ajuste completo; conta do membro ⇔ slip; pagamento completo                                                             | T-L02                                           |
| 3 índices parciais                     | `GoldLedgerEntry`                     | um resultado por aposta; um depósito por slip; uma receita e um resíduo por resultado                                                   | T-L03                                           |

Resultado: **122/122** no `titan_test` (38 migrations); os **31 RED** do §12.2 passam,
pelo nome, e o conjunto de testes é o mesmo. `pnpm test` 1.126; `api` lint, typecheck e
build OK; `format:check` OK; banco de dev com o mesmo hash.

Observação, sem mudança nesta etapa: o `titanbet_slip_aberto` confere o momento do
INSERT, não o `status` de nascimento — a §16.4 não pede isso, e os testes do M2B gravam
slips direto em `valido`/`recusado` para testar o índice parcial. Quem garante que um
slip nasce em rascunho no uso real é o fluxo de Apostas.

---

## 13. Ready — execução (23/09/2026)

**Status: GREEN.** Milestone "RED/GREEN Ready" da §7.

### 13.1 Testes e evidência

| Testes                                                        | Onde                                    | Antes da implementação                                                                                                                                        |
| ------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-E01 (novo: `BetEvent` append-only, §16.4)                   | `test/db/titan-bet/evento.db-spec.ts`   | **RED real** — com a estrutura do `BetEvent` (migration `20260923230000_titan_bet_evento_estrutura`), 2 falhas, ambas "esperado `trigger`, recebido `aceito`" |
| T-R08, T-R12                                                  | `src/titan-bet/fases.spec.ts`           | **`RED awaiting implementation seam`** — `Cannot find module './fases'`                                                                                       |
| T-K02                                                         | `src/titan-bet/candidatos.spec.ts`      | **awaiting seam** — `Cannot find module './candidatos'`                                                                                                       |
| procedência do Titan Roster (§5.4, §12)                       | `src/wowaudit/wowaudit.service.spec.ts` | **awaiting seam** — o método `getTeamCharactersSnapshot` não existia                                                                                          |
| T-R04, T-R05, T-R06, T-R07, T-B01, T-B02, T-K01, T-R10, T-R11 | `test/db/titan-bet/ready.db-spec.ts`    | **awaiting seam** — a suíte não carregava sem `ReadyService`, `ElegibilidadeService` e `TitanBetRepository`                                                   |

Os casos "awaiting seam" não contam como RED (D-42): não existia costura legítima para
executá-los sem implementar a própria regra. Foram escritos e rodados **antes** da
implementação, e a falha registrada foi a ausência do módulo.

### 13.2 Implementação

- `src/titan-bet/fases.ts` — `faseDaRodada` e `podeDarReady` (§16.5).
- `src/titan-bet/candidatos.ts` — `candidatosDoMercado` (D-04, D-13).
- `src/wowaudit/wowaudit.service.ts` — `getTeamCharactersSnapshot` com `stale`, no mesmo
  desenho do `RosterSnapshot` da Blizzard; `getTeamCharacters` continua igual por fora.
- `src/titan-bet/titan-bet.repository.ts`, `ready.service.ts`, `elegibilidade.service.ts`,
  `titan-bet.module.ts` (registrado no `AppModule`, ainda sem controller).
- migration `20260923240000_titan_bet_evento_append_only` — o `BetEvent` entra no
  `titanbet_append_only`.

O Ready lê as duas fontes com `force`, recusa cache velho, lista vazia, role fora de
`Tank/Melee/Heal/Ranged`, cutoff passado, rodada já pronta e Weekly sem boss marcado;
grava snapshots e `readyAt` numa transação (o `readyAt` só se ainda nulo); qualquer
falha vira `BetEvent` `ready_falhou` com o motivo.

**Duas escolhas de implementação, registradas para revisão:**

1. **Role desconhecida no Titan Roster recusa o Ready**, em vez de pular o personagem —
   pular congelaria um candidato a menos sem ninguém saber, o mesmo defeito do cache
   velho.
2. **Conta com vários personagens no snapshot:** o `eligibilityCharacterId` é o de melhor
   rank, o mesmo critério do personagem que representa a conta na sessão
   (`SessionUser.matchedCharacter`). Só decide o que fica gravado como evidência.

### 13.3 Resultado

`pnpm test:db` **139/139** (40 migrations); `pnpm test` com `apps/api` em **708** (+28);
`api` lint, typecheck e build OK; `format:check` OK; banco de dev com o mesmo hash.

---

## 14. Apostas — execução (23/09/2026)

**Status: GREEN.** Milestone "RED/GREEN Apostas" da §7 (Salvar, Submeter, depósito,
cutoff).

### 14.1 Testes e evidência

| Testes                                                                          | Onde                                                             | Antes da implementação                                                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| T-S13 (Zod — inclusive `200,5`, adiado do M2B), forma do slip, D-28, D-02, D-34 | `packages/shared/src/titan-bet/betting.spec.ts` — 19 casos       | **`RED awaiting implementation seam`** — `Cannot find module './betting.js'` |
| T-S01, T-S03, T-S08, T-S15, T-S16, T-S18, T-D02, T-D03                          | `apps/api/test/db/titan-bet/apostas-fluxo.db-spec.ts` — 18 casos | **awaiting seam** — `Cannot find module '…/apostas.service'`                 |

Não havia costura legítima para executar esses testes sem implementar a própria regra
(D-42); foram escritos e rodados antes da implementação, e a falha registrada foi a
ausência do módulo.

### 14.2 Implementação

- `packages/shared/src/titan-bet/betting.ts` — o contrato **privado** do slip (§9.1):
  `salvarSlipSchema`, `submeterSlipSchema`, `recusarDepositoSchema`, stake inteiro de 200
  a 1.000.
- `apps/api/src/titan-bet/apostas.service.ts` — Salvar (cria ou reusa o slip ativo e
  substitui as apostas do rascunho) e Submeter pagamento (depositante da conta, slip não
  vazio, self-bet do depositante no First Death, total = Σ stakes).
- `deposito.service.ts` — confirmar (com `deposito_validado` na mesma transação) e
  recusar (terminal, com motivo).
- `cutoff.service.ts` — expira rascunho e pendente de rodada vencida.
- `titan-bet.repository.ts` — as operações com o slip travado (`SELECT … FOR UPDATE`),
  que serializam Salvar, Submeter e confirmações concorrentes.

**Duas escolhas de implementação, registradas para revisão:**

1. **O job de cutoff roda a cada 10 minutos**, não uma vez na terça 12:00 como a tabela
   de jobs da spec (§9) sugeria. O cutoff é regra do banco (§5.5), então o job só
   materializa o `expirado`; rodando com frequência, ele pega sozinho o atraso de uma
   instância que estava fora às 12:00, que é o que a §5.5 pede.
2. **O self-bet do First Death é conferido no Submeter**, contra o depositante — é quando
   o depositante passa a existir. O caso mais amplo (outros personagens da conta) segue
   na OQ-27a.

### 14.3 Resultado

`pnpm test:db` **157/157**; `pnpm test`: shared **318** (+19), api 708, web 147; `api`
lint, typecheck e build OK; `format:check` OK; banco de dev com o mesmo hash.

---

## 15. Autorização — execução (23/09/2026)

**Status: GREEN.** Milestone "RED/GREEN Autorização" da §7 (Officer Panel e dado
privado). Primeiras rotas do Titan Bet.

### 15.1 Testes e evidência

| Testes                                                                                                   | Onde                                                         | Antes da implementação                                                                                                                    |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| T-D01 (contrato), leitura do próprio slip                                                                | `packages/shared/src/titan-bet/betting-leitura.spec.ts` — 10 | **`RED awaiting implementation seam`** — 10 falhas, `Cannot read properties of undefined` (os schemas não existiam no `betting.ts`)       |
| T-Z01, T-R02, T-D05, T-Z07; T-Z02 e T-Z03 no lado HTTP; 400 antes do service; recusa de domínio → status | `apps/api/src/titan-bet/titan-bet.controller.spec.ts` — 28   | **awaiting seam** — `Cannot find module './titan-bet-member.controller'`: o teste foi escrito antes da primeira rota (§5.3)               |
| T-Z02, T-Z03 e T-D01 no banco                                                                            | `apps/api/test/db/titan-bet/autorizacao.db-spec.ts` — 5      | **awaiting seam** — 5 falhas: `apostas.meuSlip is not a function`, `deposito.pendentes is not a function`, `ContaNaoElegivel` inexistente |

Nenhum controller foi criado sem guard para produzir falha, e nenhum 404 de rota
inexistente foi contado como RED (§5.3): as rotas nasceram com o guard, depois dos
testes.

### 15.2 Implementação

| Rota                                                         | Guard          | Faz                                          |
| ------------------------------------------------------------ | -------------- | -------------------------------------------- |
| `GET /internal/titan-bet/rodadas/:roundId/slip`              | `RosterGuard`  | o slip da própria conta; 404 se não houver   |
| `PUT /internal/titan-bet/rodadas/:roundId/slip`              | `RosterGuard`  | Salvar (D-27)                                |
| `POST /internal/titan-bet/rodadas/:roundId/slip/submeter`    | `RosterGuard`  | Submeter pagamento (D-27)                    |
| `POST /internal/titan-bet/officer/rodadas/:roundId/ready`    | `OfficerGuard` | Ready (D-31)                                 |
| `GET /internal/titan-bet/officer/rodadas/:roundId/depositos` | `OfficerGuard` | depósitos pendentes, só de `BetSlip` (§16.9) |
| `POST /internal/titan-bet/officer/slips/:slipId/confirmar`   | `OfficerGuard` | confirmar depósito                           |
| `POST /internal/titan-bet/officer/slips/:slipId/recusar`     | `OfficerGuard` | recusar depósito, com motivo (D-34)          |

- `titan-bet-member.controller.ts` e `titan-bet-officer.controller.ts`, cada um com o
  guard **no controller**, não por rota — rota nova que esquecesse o decorator seria o
  Officer Panel aberto.
- `packages/shared/src/titan-bet/betting.ts` — `meuSlipSchema`, `depositoPendenteSchema`
  (estrito, só `aguardando_deposito`), `depositosPendentesSchema`.
- `ApostasService.meuSlip` e `ContaNaoElegivel`; `DepositoService.pendentes`;
  `TitanBetRepository.slipsDaConta` (filtro por dono no repository, §9.1) e
  `depositosPendentes` (sem join em `Bet`).
- `http.ts` — recusa de domínio vira status: conta fora do snapshot **403**, aposta
  recusada **422**, Ready e depósito recusados **409**.
- `yaak/` — pasta `titan-bet` com as sete requests.

**Escolhas de implementação, registradas para revisão:**

1. **Não existe leitura de slip por id no lado do membro.** O slip é "o da conta da
   sessão nesta rodada"; T-Z02 vira "B não recebe o slip de A", em vez de "A pede o id
   de B e leva 403/404" — não há id a pedir.
2. **Qual slip o `GET` devolve:** o ativo; sem ativo, o mais recente — um recusado
   continua visível para o dono, com o motivo.
3. **Os controllers ainda não cobrem configuração da rodada** (encounters e mercados em
   PREPARATION) nem a criação da rodada (`bet-abre-rodada`): não estão na matriz, e
   ficam para quando forem especificados.

### 15.3 Resultado

`pnpm test:db` **162/162**; `pnpm test`: shared **328** (+10), api **736** (+28), web
147; `api` lint, typecheck e build OK; `format:check` OK; banco de dev com o mesmo hash.

---

## 16. Odds — execução (23/09/2026)

**Status: GREEN.** Milestone "RED/GREEN Odds" da §7 (projected payout).

### 16.1 Testes e evidência

| Testes                                    | Onde                                                       | Antes da implementação                                                                       |
| ----------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| T-O03                                     | `packages/shared/src/titan-bet/published.spec.ts` — 8      | **`RED awaiting implementation seam`** — `Cannot find module './published.js'`               |
| T-O01                                     | `apps/api/src/titan-bet/odds.spec.ts` — 4                  | **awaiting seam** — `Cannot find module './odds'`                                            |
| T-Z08 no HTTP (rota de odds: 401/403/200) | `apps/api/src/titan-bet/titan-bet.controller.spec.ts` — +3 | **awaiting seam** — `Cannot find module './odds.service'`; a rota nasceu com o `RosterGuard` |
| T-O02, T-Z06, T-Z08                       | `apps/api/test/db/titan-bet/odds.db-spec.ts` — 6           | **awaiting seam** — `Cannot find module '…/odds.service'`                                    |
| T-Z05                                     | `published.spec.ts` — 1                                    | **guarda de regressão**, sem RED (§5.4); entrou junto com o `published.ts`                   |

T-Z05 estava listado no milestone de Auditar; entrou aqui porque o `published.ts` nasceu
neste milestone, e a guarda protege o arquivo desde o primeiro commit.

### 16.2 Implementação

- `packages/shared/src/titan-bet/published.ts` — `oddsDaRodadaSchema`, estrito em todos
  os níveis: `roundId`, e por mercado `marketId` e `opcoes[{ characterId,
multiplicador }]`. `multiplicador` positivo ou `null` ("—").
- `apps/api/src/titan-bet/odds.ts` — `multiplicadorProjetado(V, S)` =
  `floor(9V/10) / S`, `null` se `S = 0`.
- `odds.service.ts` — confere o snapshot de bettors (`ContaNaoElegivel` → 403), junta o
  cardápio às somas e monta uma opção por candidato do mercado.
- `TitanBetRepository.somasValidasPorOpcao` — `groupBy` sobre `Bet` de slips `valido`:
  nenhuma aposta individual sai do repository.
- `GET /internal/titan-bet/rodadas/:roundId/odds` no controller do membro (`RosterGuard`);
  o controller passou a ter base `rodadas/:roundId`, com as rotas de slip iguais por fora.
- `yaak/` — request de odds.

**Escolhas de implementação, registradas para revisão:**

1. **A Weekly Progression fica fora da resposta.** É a OQ-55 (T-O04, bloqueado): listar
   conjuntos publicaria seleções privadas. Omitir não expõe nada e não decide a OQ — o
   que vier dela entra como campo novo no contrato.
2. **A resposta só tem o multiplicador**, sem o `V` do mercado que a §16.10 permite "se a
   tela quiser": com `V` e o multiplicador, `S(o)` sai por conta, e nada pediu esse número
   ainda.
3. **Odds não dependem da fase da rodada.** Quem vê é o bettor do snapshot, que só existe
   depois do Ready; depois do cutoff a pool não muda mais e o número continua certo.

### 16.3 Resultado

`pnpm test:db` **168/168**; `pnpm test`: shared **337** (+9), api **743** (+7), web 147;
`api` lint, typecheck e build OK; `shared` typecheck OK; `format:check` OK; banco de dev
com o mesmo hash.

---

## 17. Auditar — execução (23/09/2026)

**Status: GREEN.** Milestone "RED/GREEN Auditar" da §7: descobrir e resolver a fonte de
cada sessão. O cálculo dos resultados é o milestone seguinte.

### 17.1 Testes e evidência

| Testes                                                    | Onde                                                  | Antes da implementação                                                                                                                                                           |
| --------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-A06 (CHECK), T-A07, T-A08, T-A11                        | `test/db/titan-bet/auditoria.db-spec.ts` — 15         | **RED real** — com a estrutura (`20260923250000_titan_bet_auditoria_estrutura`), 10 falhas, todas "esperado `unique`/`check`/`trigger`, recebido `aceito`"; 5 controles passando |
| T-A01, T-A02, T-A03, classificação e resolução por sessão | `src/titan-bet/auditoria.spec.ts` — 24                | **`RED awaiting implementation seam`** — `Cannot find module './auditoria'`                                                                                                      |
| `podeAuditar`                                             | `src/titan-bet/fases.spec.ts` — +2                    | **RED** — `podeAuditar is not a function` (o módulo existia; a função, não)                                                                                                      |
| T-A04, T-A05, T-A06, T-A09, T-A12, pré-condições          | `test/db/titan-bet/auditar-fluxo.db-spec.ts` — 14     | **awaiting seam** — `Cannot find module '…/auditoria.service'`                                                                                                                   |
| contrato do Officer Panel                                 | `packages/shared/src/titan-bet/auditoria.spec.ts` — 4 | **awaiting seam** — `Cannot find module './auditoria.js'`                                                                                                                        |
| T-Z01 estendido (3 rotas novas) e T-Z07 do Auditar        | `src/titan-bet/titan-bet.controller.spec.ts` — +15    | 12 falhas por **rota inexistente (404)** — não contam como RED de autorização (§5.3); as rotas nasceram com o `OfficerGuard` do controller                                       |

"Sessão fora do enum" (T-A11) passa desde a estrutura — é o enum, não o invariante — e
está declarado assim no teste. T-A10 (`difficulty 5` de dungeon) já é coberto pelo
`toRaidPulls` (`warcraftlogs.service.spec.ts`, "descarta boss de dungeon mesmo em
difficulty de raid"): **guarda de regressão**, sem RED; o Titan Bet passa a depender dele
no cálculo de resultados. Depois do GREEN, um teste a mais confere a vista do Officer
Panel contra o contrato do shared (não conta como RED).

### 17.2 Implementação

- Migrations `20260923250000_titan_bet_auditoria_estrutura` (enums `BetAuditStatus`,
  `BetAuditSession`, `BetSourceResolution`; `BetAudit`, `BetAuditSource`) e
  `20260923260000_titan_bet_auditoria_invariantes` (unique `(auditId, session)`, índice
  parcial `BetAudit_uma_confirmada_por_rodada`, três CHECKs, trigger
  `titanbet_resultado_imutavel` em `BetAudit` e `BetAuditSource`).
- `src/titan-bet/auditoria.ts` — `ehReportTitanbet`, `sessaoDoReport`, `sessaoDaFight`,
  `classificarReports`, `resolverSessao`.
- `auditoria.service.ts` — `auditar`, `escolherFonte`, `corrente`; `fases.ts` —
  `podeAuditar`.
- `WarcraftLogsService.listGuildReports` — `code title revision startTime`; nenhuma regra de
  aposta no módulo do WCL. `loadGuildTimezone()` no `guild.config.ts`.
- Rotas (`OfficerGuard`): `POST officer/rodadas/:roundId/auditar`, `GET
officer/rodadas/:roundId/auditoria`, `POST
officer/auditorias/:auditId/fontes/:session/escolher`. Contrato em
  `packages/shared/src/titan-bet/auditoria.ts`. Três requests no `yaak/`.

**Escolhas de implementação, registradas para revisão:**

1. **As sessões saem do `cutoffAt`, no fuso da guilda:** terça é o dia local do cutoff, e
   só a partir dele; quinta é dois dias depois. Report iniciado na terça **antes** do
   cutoff é da semana anterior ao reset e não conta — contar deixaria apostar com a raid
   já em andamento.
2. **Os CHECKs da fonte são mais estritos que a §16.4:** `⇔` em vez de `⇒` (fonte
   `ausente`/`ambigua` não tem report) e a referência inteira ou nula — congelar `code` sem
   `revision` não congela nada. A §16.4 foi atualizada.
3. **`substituida` também é terminal no trigger**, não só `confirmada`: é o "intacta" do
   T-A09 garantido pelo banco. A §16.4 foi atualizada.
4. **A escolha do officer só vale entre os candidatos gravados**, sem nova consulta ao WCL
   (T-A12), e só na sessão `ambigua`. A sessão `ausente` continua sem saída: é a OQ-45
   (T-A13, bloqueado); refazer o Auditar é o que existe hoje.
5. **WCL fora do ar não cria tentativa** (§7.4) — o Auditar é recusado com o motivo.

### 17.3 Resultado

`pnpm test:db` **198/198**; `pnpm test`: shared **341** (+4), api **781** (+38), web
147; `api` lint, typecheck e build OK; `shared` typecheck OK; `format:check` OK; banco
de dev com o mesmo hash.

---

## 18. Resultados — execução (23/09/2026)

**Status: GREEN no domínio; T-F06 pendente.** Milestone "RED/GREEN Resultados" da §7.

### 18.1 Testes e evidência

| Testes                                                  | Onde                                    | Antes da implementação                                                       |
| ------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| T-F01–T-F05, T-P01–T-P05, T-W01–T-W04, e casos de borda | `src/titan-bet/resultados.spec.ts` — 29 | **`RED awaiting implementation seam`** — `Cannot find module './resultados'` |

### 18.2 Implementação

`src/titan-bet/resultados.ts`, domínio puro: `killDaSemana`, `resultadoTopMetrica`,
`resultadoFirstDeathFarm`, `resultadoFirstDeathProgressao`, `killsDaSemana`,
`weeklyVence`. Entradas já resolvidas (pulls com sessão do report, mortes por id do
`Character`, métrica como número lido); saída `vencedores` ou **proposta** de `anulado`
com `voidReason` (`sem_kill`, `sem_vencedor`, `sem_pull`) e a evidência de cada cálculo.

**Escolhas de implementação, registradas para revisão:**

1. **Duas kills do mesmo boss na semana → `revisao`**, sem escolher (§7.2, anomalia). O
   que o officer faz depois é a OQ-40 (T-A15, bloqueado).
2. **Kill com candidatos, mas sem nenhum valor de candidato → `sem_vencedor`**, o mesmo
   caminho de "sem vencedor → proposta de VOID" da §7.3.
3. **A kill conta como try** no First Death de progressão — a §7.3 diz "todas as pulls
   Mythic válidas do boss".

### 18.3 T-F06 fica para quando o cálculo tiver fonte

T-F06 ("valor de parse usado fica congelado") é de service + banco: precisa gravar
`BetMarketResult*` com a evidência e de um passo de cálculo que lê as fights do WCL. Esse
passo depende de decisões ainda abertas:

- **OQ-25** — qual métrica e qual variante de parse; define o que o WCL é chamado para
  ler e os campos da evidência da §15.10;
- **OQ-34** (off-spec) e **OQ-47** (`K` ∩ encounters configurados);
- **gates #1, #2 e #6 do M0**, manuais, antes de settlement automático.

First Death e Weekly não dependem da OQ-25, mas gravar resultado de metade dos mercados
com um modelo de evidência que a outra metade vai mudar é o retrabalho que a matriz evita.

### 18.4 Resultado

`pnpm test` api **810** (+29); `api` lint e typecheck OK.

---

## 19. Settlement — domínio (23/09/2026)

**Status: GREEN no domínio; o resto do milestone aguarda o resultado persistido.**

### 19.1 Testes e evidência

| Testes                                  | Onde                                | Antes da implementação                                                   |
| --------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| T-M01–T-M06, T-L04, `W = 0`, pool vazia | `src/titan-bet/rateio.spec.ts` — 11 | **`RED awaiting implementation seam`** — `Cannot find module './rateio'` |

### 19.2 Implementação

`src/titan-bet/rateio.ts`: `ratearMercado` (`V`, `P = floor(9V/10)`, `W`, prêmio
`floor(P × stake / W)` por aposta vencedora, `G₀` e resíduo para a guilda),
`restituirMercado` (VOID: stake inteiro, guilda 0) e `saldoDevido` (§16.6).

**Caso não definido pela spec, registrado sem decidir:** mercado com resultado, mas
**nenhuma aposta válida em opção vencedora** (`W = 0`) — o que acontece com a pool `V`?
Restituir como `VOID`? Guild Bank? O domínio devolve `sem_aposta_vencedora` e não rateia.
Levada à liderança e **resolvida na D-44** (registrada como OQ-57, porque a OQ-56 já
existia na spec). A redistribuição é o T-M10–T-M15.

### 19.3 O que falta no milestone, e por quê

T-M07, T-M08 e T-L05–T-L07 gravam `premio`, `restituicao_anulado`, `receita_guilda`,
`residuo_guilda` e `pagamento` a partir de `BetMarketResult` confirmado — que ainda não
existe (§18.3: o passo de cálculo depende da OQ-25). Closing (T-C01–T-C03) e E2E vêm
depois do settlement.

### 19.4 Resultado

`pnpm test` api **821** (+11); `api` lint e typecheck OK.

---

## 20. Redistribuição do `W = 0` — execução (23/09/2026)

**Status: GREEN.** T-M10–T-M15 (D-44; spec §8.6).

| Testes      | Onde                                   | Antes da implementação                                                       |
| ----------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| T-M10–T-M15 | `src/titan-bet/liquidacao.spec.ts` — 9 | **`RED awaiting implementation seam`** — `Cannot find module './liquidacao'` |

`src/titan-bet/liquidacao.ts` — `liquidarRodada`: premiáveis (`vencedores` e `W > 0`)
rateiam `P + cotas`; órfãos (`vencedores` e `W = 0`) dão `G₀` e o resto da divisão à
guilda e repartem o `P` igualmente entre os premiáveis; `VOID` restitui. Órfão com
`P > 0` sem premiável → `sem_mercado_premiavel`, nada liquidado — o caso que a D-44 manda
parar e consultar. Órfão com `P = 0` não tem o que repartir e não trava.

`pnpm test` api **830** (+9); lint e typecheck OK.

---

## 21. Preparação da semana — execução (23/09/2026)

**Status: GREEN.** Milestone "RED/GREEN Preparação" (D-45), T-G01–T-G11.

### 21.1 Testes e evidência

| Testes                  | Onde                                               | Antes da implementação                                                                                  |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| T-G01 (calendário)      | `src/titan-bet/calendario.spec.ts` — 6             | **`RED awaiting implementation seam`** — `Cannot find module './calendario'`                            |
| T-G04, T-G09 (contrato) | `packages/shared/src/titan-bet/config.spec.ts` — 8 | **awaiting seam** — `Cannot find module './config.js'`                                                  |
| T-G01–T-G08, T-G10      | `test/db/titan-bet/preparacao.db-spec.ts` — 17     | **awaiting seam** — `Cannot find module '…/preparacao.service'`                                         |
| T-G11                   | `src/titan-bet/titan-bet.controller.spec.ts` — +14 | **awaiting seam** — `Cannot find module './preparacao.service'`; as rotas nasceram com o `OfficerGuard` |

Um ajuste de teste depois do RED, registrado: em T-G01 o formato do `Intl` em Node é
`Tue 12:00`, sem a vírgula que o teste esperava. A leitura passou a ser por partes (dia
da semana, hora, minuto, segundo) — a mesma asserção, sem afrouxar. Depois do GREEN,
um teste a mais: quem cria a rodada fica no `BetEvent` `rodada_criada` (não conta como
RED; o lint mostrou que o officer chegava ao `criar` e não era registrado).

### 21.2 Implementação

- `src/titan-bet/calendario.ts` — `proximaRodada`: cutoff na próxima terça 12:00 local,
  abertura na sexta 00:00 antes dele; fuso medido no instante (horário de verão entra).
- `packages/shared/src/titan-bet/config.ts` — `prepararRodadaSchema` (estrito, sem
  pessoas; progressão só com First Death; boss na Weekly exige a Weekly),
  `preparacaoDaRodadaSchema`, `catalogoDeRaidSchema`.
- `src/titan-bet/preparacao.service.ts` — `criar` (period = corrente da Blizzard + 1),
  `catalogo`, `ver`, `salvar` declarativo: compara com o que existe, aplica só a
  diferença e grava um `BetEvent` `configuracao_salva` com encounters e mercados
  criados, alterados e removidos; sem mudança, nada é escrito.
- Migration `20260923270000_titan_bet_evento_configuracao` — `rodada_criada` e
  `configuracao_salva` no `BetEventType`.
- Rotas (`OfficerGuard`): `POST officer/rodadas`, `GET officer/catalogo`, `GET` e `PUT
officer/rodadas/:roundId/preparacao`; quatro requests no `yaak/`.

**Escolhas de implementação, registradas para revisão:**

1. **`period` = period corrente da Blizzard + 1**: o cutoff é o próximo reset, e é nele
   que o period da rodada começa. Entre seasons (Blizzard sem season corrente) a criação
   falha com o erro da Blizzard.
2. **Troca de track apaga e recria os mercados do boss** — a FK composta propaga o track e
   o CHECK recusaria um Top DPS num boss que virou progressão. O evento registra a
   mudança lógica, não o apaga-e-recria.
3. **Boss marcado na Weekly com a Weekly desligada é recusado** no contrato e no service —
   estado sem sentido.
4. **O job `bet-abre-rodada` da §9 não foi feito:** a D-45 pede o fluxo no Officer Panel.

### 21.3 Resultado

`pnpm test:db` **216/216**; `pnpm test`: shared **349** (+8), api **850** (+20), web
147; `api` lint, typecheck e build OK; `format:check` OK; banco de dev com o mesmo hash.

---

## 22. Resultado persistido — execução (23/09/2026)

**Status: GREEN.** T-X01–T-X07 (§3.15) e a metade de banco do T-F06.

| Testes      | Onde                                          | Antes da implementação                                                                                                                                                                |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-X01–T-X07 | `test/db/titan-bet/resultado.db-spec.ts` — 21 | **RED real** — com a estrutura (`20260923280000_titan_bet_resultado_estrutura`), 17 falhas, todas "esperado `unique`/`fk`/`check`/`trigger`, recebido `aceito`"; 4 controles passando |

Migration `20260923290000_titan_bet_resultado_invariantes`: unique `(auditId, marketId)`,
FKs compostas (auditoria e mercado da rodada; vencedor → `BetRoundCandidate`; kill →
encounter da rodada), três CHECKs do desfecho e o trigger `titanbet_resultado_imutavel`
em `BetMarketResult`, `BetMarketResultWinner` e `BetMarketResultKill` (só INSERT, e só com
a auditoria `pronta`).

**Guarda T-L08 alinhada à própria definição.** A matriz define o T-L08 como "nenhum valor
financeiro fora do ledger **além de V/P/W** e `expectedTotal`", mas a implementação não
fazia a exceção, e o `winningStake` (o W, §16.6) quebrou o guarda. Ele passou a nomear as
três colunas de V/P/W do `BetMarketResult` como exceção; a regex e todo o resto seguem
iguais — qualquer outra coluna de dinheiro continua quebrando.

`pnpm test:db` **237/237**; `api` lint, typecheck e build OK; banco de dev com o mesmo hash.

---

## 23. Cálculo do Auditar — execução (23/09/2026)

**Status: GREEN.** §3.16. Completa o T-F06 (a metade de service).

### 23.1 Testes e evidência

| Testes             | Onde                                                          | Antes da implementação                                                                                                        |
| ------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| T-W06              | `src/titan-bet/leitura-wcl.spec.ts` — 13                      | **`RED awaiting implementation seam`** — `Cannot find module './leitura-wcl'`                                                 |
| T-W07              | `src/warcraftlogs/titan-bet-report.spec.ts` — 3               | **RED** — `wcl.getTitanBetReport is not a function` (o serviço existia; o método, não)                                        |
| T-Q01–T-Q06        | `test/db/titan-bet/calculo.db-spec.ts` — 10                   | **awaiting seam** — `Cannot find module '…/calculo.service'`                                                                  |
| T-Q07 e o contrato | controller spec +7; `packages/shared/…/resultado.spec.ts` — 2 | 7 falhas por rota inexistente (404, não conta como RED de autorização, §5.3); contrato: `Cannot find module './resultado.js'` |

### 23.2 Implementação

- `src/titan-bet/leitura-wcl.ts` — `identificarAtor` (`toCharacterKey` + `toRealmMatchKey`),
  `pullsDoReport`, `valoresDaKill` (D-47: DPS/HPS = total ÷ duração; Parse % =
  `rankPercent` de `Rankings/Today`; dispels = soma da tabela por ator) e
  `dispelsPorAtor`.
- `WarcraftLogsService.getTitanBetReport` — duas queries e a paginação das mortes; só
  forma de dado. **Rodado contra a API real** (report de 22/09): 15 fights Mythic, 142
  mortes, duas kills com tabelas e rankings; os dispels reais vieram na estrutura que o
  leitor espera, com `id` do ator nos `details`, e a soma da tabela por jogador bateu com
  a contagem de eventos de dispel (16).
- `src/titan-bet/calculo.service.ts` — `calcular` (só auditoria `pronta`; lê só os
  reports congelados; grava resultados, vencedores, `K` e a evidência §15.10 com
  `titanbet-1`; auditoria `calculada`) e `resultados` (a vista do officer).
- Rotas (`OfficerGuard`): `POST officer/auditorias/:auditId/calcular`, `GET
officer/auditorias/:auditId/resultados`; contrato `resultadosDaAuditoriaSchema`; duas
  requests no `yaak/`.

**Escolhas de implementação, registradas para revisão:**

1. **OQ-47 não é decidida:** se um boss Mythic do catálogo de raid morreu nos reports
   oficiais e **não** está marcado na Weekly, as duas leituras de `K` divergem, e o cálculo
   **recusa** com o motivo. Quando todo boss morto está na Weekly, as leituras coincidem e
   o cálculo segue.
2. **Duas kills do mesmo boss → recusa** com "pede revisão" (§7.2, OQ-40); a auditoria
   fica `pronta` e nada é gravado.
3. **Recalcular é outra tentativa** (D-30): uma auditoria `calculada` não calcula de novo,
   e o banco não deixa mudar resultado.
4. **Off-spec (OQ-34) não é tratado:** o valor do candidato entra se ele é candidato do
   mercado pela role do snapshot, qualquer que seja a spec jogada.
5. **A evidência ainda não tem schema no shared** — fica como documento versionado
   (`versao: 1`, `algoritmo: titanbet-1`) e é exposta ao officer como objeto. Formalizá-la
   é do milestone do Closing Report, que é quem a publica.

### 23.3 Resultado

`pnpm test:db` **247/247**; `pnpm test`: shared **351**, api **873**, web 147; `api`
lint, typecheck e build OK; banco de dev com o mesmo hash.

---

## 24. Settlement no banco — execução (23/09/2026)

**Status: GREEN.** Fecha o milestone "RED/GREEN Settlement": T-M07, T-M08, T-L05,
T-L06, T-L07, e T-M13/T-M14 integrados ao banco.

### 24.1 Testes e evidência

| Testes                                          | Onde                                               | Antes da implementação                                                               |
| ----------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| T-M07, T-M08, T-M13, T-M14, T-L05, T-L06, T-L07 | `test/db/titan-bet/settlement.db-spec.ts` — 12     | **`RED awaiting implementation seam`** — `Cannot find module '…/settlement.service'` |
| contrato de pagamento e ajuste                  | `packages/shared/src/titan-bet/ledger.spec.ts` — 3 | **awaiting seam** — `Cannot find module './ledger.js'`                               |
| rotas (T-Z01 estendido, officer 2xx)            | controller spec +13                                | 13 falhas por rota inexistente (404; não conta como RED de autorização, §5.3)        |

### 24.2 Implementação

- `settlement.service.ts` — `SettlementService.confirmar`: com a auditoria travada, lê
  resultados e apostas válidas, liquida a rodada inteira (`liquidarRodada`, com a D-44) e
  lança `premio`, `restituicao_anulado`, `receita_guilda` e `residuo_guilda` junto com a
  auditoria `confirmada`, na mesma transação. `planejarSettlement` é puro. Recusa: auditoria
  que não está calculada; `V` que não bate com o do cálculo; e **nenhum mercado premiável
  para um órfão** (D-44: consultar a liderança). Linha de valor zero não é lançada.
- `LedgerService` — `saldos` (devido e pago por membro, §8.5), `saldo`, `pagar` (o saldo
  inteiro, com o slip travado — dois pagamentos simultâneos pagam uma vez) e `ajustar`
  (com sinal, motivo, lançamento corrigido da mesma conta; saldo negativo recusado —
  OQ-52).
- Rotas (`OfficerGuard`): `POST officer/auditorias/:auditId/confirmar`, `GET
officer/rodadas/:roundId/saldos`, `POST officer/slips/:slipId/pagar`, `POST
officer/slips/:slipId/ajustes`; contrato `ajustarSchema`, `saldosDaRodadaSchema`;
  quatro requests no `yaak/`.

**Escolhas de implementação, registradas para revisão:**

1. **A conta do membro é o slip** (§16.6): pagar e ajustar operam por slip — há no máximo
   um slip válido por conta por rodada.
2. **Confirmar sem apostas válidas** confirma e não lança nada.
3. **Ajuste que zera exatamente o saldo** é aceito; só o negativo espera a OQ-52.

### 24.3 Resultado

`pnpm test:db` **259/259**; `pnpm test`: shared **354**, api **886**, web 147; `api`
lint, typecheck e build OK; banco de dev com o mesmo hash.

---

## 25. Closing Report — execução parcial (23/09/2026)

**Status: T-C02 GREEN; T-C01 e T-C03 aguardam a OQ-51.**

| Testes | Onde                                       | Antes da implementação                                                                                                         |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| T-C02  | `test/db/titan-bet/closing.db-spec.ts` — 5 | **RED real** — com a estrutura (`20260923300000_titan_bet_closing_estrutura`), 4 falhas, todas "recebido `aceito`"; 1 controle |

Migration `20260923310000_titan_bet_closing_invariantes`: unique `(roundId, version)`, FK
composta da auditoria com a rodada e `titanbet_append_only` (UPDATE, DELETE e TRUNCATE).

**Por que T-C01 parou.** O conteúdo tem de trazer "os vencedores e quanto cada um ganhou
em cada mercado" e "o total devido a cada membro" (§8.5). **Como cada membro aparece** no
documento publicado — battletag, personagem, outra coisa — é a OQ-51 (T-C04, bloqueado),
e ela define os campos do schema publicado que o T-C01 valida. O service e a guarda
T-C03 nascem com esse schema. O E2E (T-E01) termina no closing report e espera o mesmo.

`pnpm test:db` **264/264**.

---

## 26. D-49 e D-51 — execução (23/09/2026)

| Testes | Onde                                                                                                     | Antes da implementação                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-W05  | `src/titan-bet/resultados.spec.ts` (+1); `test/db/titan-bet/calculo.db-spec.ts` (troca do caso da OQ-47) | **RED real** — o domínio punha o boss fora da Weekly em `K`; o cálculo recusava com "o K depende da OQ-47". A decisão D-49 trocou o esperado desse caso |
| T-K04  | `test/db/titan-bet/calculo.db-spec.ts` (+1)                                                              | **guarda de regressão**, sem RED (§5.4): a role do snapshot já decidia o mercado; o teste fixa isso como a D-51                                         |

`killsDaSemana` passa a receber os encounters da Weekly congelados no Ready e ignora
kill fora deles; o cálculo deixou de recusar e de ler o catálogo de raid (a porta do WCL
do cálculo ficou só com `getTitanBetReport`). O caso de teste que exigia a recusa da
OQ-47 foi **substituído** pelo T-W05: não é afrouxamento, é a decisão de produto que
mudou o esperado.

D-50 (OQ-52) não mudou código: o T-L06 já exige a recusa do saldo negativo.

---

## 27. Closing Report — execução (23/09/2026)

**Status: GREEN.** T-C01, T-C03, T-C04, T-C05 (D-48).

| Testes                  | Onde                                                   | Antes da implementação                                                                        |
| ----------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| T-C01, T-C04 (contrato) | `packages/shared/src/titan-bet/published.spec.ts` — +8 | **awaiting seam** — `closingReportSchema` não existia (`Cannot read properties of undefined`) |
| T-C01, T-C04, T-C05     | `test/db/titan-bet/closing-servico.db-spec.ts` — 6     | **awaiting seam** — `Cannot find module '…/closing.service'`                                  |
| T-C03                   | `src/titan-bet/closing.guarda.spec.ts` — 2             | **guarda de regressão** (§5.4); rodada antes do módulo existir: `Cannot find module`          |
| rotas                   | controller spec +5                                     | **awaiting seam** — `Cannot find module './titan-bet-results.controller'`                     |

**Um ajuste na guarda T-C03, antes do GREEN, registrado.** A primeira versão proibia
qualquer `battletag` no `closing.repository.ts`, mas a §16.7 exige gravar o officer que
publica (`publishedByBattletag`). A guarda passou a proibir o que ela protege — a conta do
**membro** (`ownerBattletag`, `ownerUserId`) — e continua proibindo `Bet`, escolhas, stake,
`expectedTotal` e o depositante. Uma tentativa minha de disfarçar o nome da coluna para
passar pela guarda foi descartada antes de rodar: guarda se corrige na definição, nunca se
contorna.

Implementação: `closingReportSchema` e `closingPublicadoSchema` em `published.ts` (ainda
sem nenhum import de `betting`, T-Z05); `closing.repository.ts` — repository próprio que
só lê resultado confirmado, ledger e o personagem de elegibilidade (nome e realm do
snapshot de bettors); `closing.service.ts` — `publicar` (versão nova a cada vez, marca
d'água no último lançamento, conteúdo validado antes de gravar) e `ultimo`; rotas `POST
officer/rodadas/:roundId/closing` (`OfficerGuard`) e `GET rodadas/:roundId/closing` no
`titan-bet-results.controller.ts` (`RosterGuard`); duas requests no `yaak/`.

**Escolhas de implementação, registradas para revisão:**

1. **"Total devido" é o que a conta recebeu na rodada** (prêmio + restituições + ajuste),
   independente de já ter sido pago — o documento não muda quando o officer paga.
2. **VOID aparece com o motivo e sem linhas por membro**: a restituição por aposta é o
   stake e não é publicada; entra só no total agregado da pessoa, como a D-48 pede.
3. **Membro sem crédito não aparece** nos totais (quem só perdeu não é listado).

---

## 28. E2E — execução (23/09/2026)

**Status: GREEN.** T-E01, `test/db/titan-bet/e2e.db-spec.ts`: preparar a semana → Ready
→ Salvar → Submeter pagamento → confirmar depósito → cutoff → Auditar → calcular →
confirmar → pagar → Closing Report, com todos os serviços e o banco reais e só as fontes
externas como dublês (roster da Blizzard, Titan Roster, WCL).

**Sem RED, declarado:** o E2E é integração, escrito depois de todos os componentes; passar
na primeira execução é o esperado — cada peça já tinha o seu RED no milestone próprio.

O que ele confere de ponta a ponta: o total a depositar do Submeter, o rateio de dois
mercados (Top DPS e Weekly com `K` da D-49), o saldo e o pagamento, a reconciliação da
§16.6 (Σ depósitos = Σ prêmios + receita da guilda) e o Closing Report com o membro pelo
personagem de elegibilidade (D-48), sem BattleTag e sem quem só perdeu.

Limitação conhecida: o report de "terça" do teste começa 1 s depois do cutoff; se o teste
rodar exatamente no último segundo do dia no fuso da guilda, a sessão cai no dia seguinte.

## 29. Estado da matriz (23/09/2026)

Todos os milestones da §7 estão GREEN, com a revisão 10 incorporada. O que resta na
matriz está **bloqueado por OQ** (§4): OQ-03, OQ-04a, OQ-27a, OQ-28, OQ-30, OQ-39, OQ-40,
OQ-45, OQ-46, OQ-48, OQ-50, OQ-54, OQ-55 e OQ-56. As telas do front (`/interno/bet`) e o
cardápio de mercados para a tela do membro não estão na matriz.

---

## 30. Revisão 11, milestone 1 — Weekly por boss e `sem_vencedor` (24/09/2026)

**Status: GREEN.** D-54 e D-61 — **mudança de produto**, não correção.

### 30.1 RED

| Camada   | Onde                                                           | RED                                                                                                                                                                                                                                                                                              |
| -------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| banco    | `test/db/titan-bet/weekly.db-spec.ts` — 10 (T-W14, T-M17)      | **RED real** contra `20260924000000_titan_bet_weekly_por_boss_estrutura`: 5 × "recebido `aceito`" e o controle de `sem_vencedor` recusado pelo CHECK antigo. Três casos do T-M17 passavam pelo motivo errado (o CHECK antigo recusava qualquer `sem_vencedor`) — o controle falhando mostra isso |
| contrato | `packages/shared/src/titan-bet/*.spec.ts` — 9 casos reescritos | **RED** — 9 falhas pela forma antiga (conjunto de bosses, marcação da Weekly, odds sem Weekly, `voidReason`/`kills`)                                                                                                                                                                             |
| domínio  | `resultados.spec.ts`, `liquidacao.spec.ts` — 13                | **RED** — `resultadoWeekly` ausente; `sem_vencedor` desconhecido na liquidação; desfechos ainda `anulado`                                                                                                                                                                                        |
| serviço  | 9 suítes de banco                                              | **RED** — 85 falhas: código de produção no modelo antigo                                                                                                                                                                                                                                         |

### 30.2 O que mudou

- **Banco:** `BetWeeklySelection` removida; `BetRoundEncounter.inWeeklyProgression` removida;
  `Bet.targetEncounterId`/`targetEncounterTrack` com FK composta para o encounter de
  progressão da rodada e três CHECKs; `BetResultOutcome.sem_vencedor` com o CHECK do
  desfecho refeito (V e P presentes, W = 0). O trigger de editabilidade perdeu o ramo da
  tabela removida. `BetMarketResultKill` passou a guardar **os bosses vencedores da
  Weekly**.
- **Contratos:** aposta da Weekly `{ marketId, stake, encounterId }`; preparação sem
  `inWeeklyProgression`; odds com opção `{ characterId }` ou `{ roundEncounterId }`;
  resultados e closing com desfecho `sem_vencedor`, `motivo` no lugar de `voidReason` e
  `bossesVencedores` no lugar de `kills`.
- **Domínio:** `resultadoWeekly` (bosses de progressão mortos); todo "sem vencedor"
  calculado vira `sem_vencedor` com motivo; `killsDaSemana` e `weeklyVence` removidos; a
  liquidação trata `sem_vencedor` como órfão (D-61 + D-44).
- **Serviços:** Salvar valida o boss de progressão; odds da Weekly por boss; Ready exige
  boss de progressão para a Weekly; cálculo por boss e `sem_vencedor` (algoritmo
  `titanbet-2`); settlement vence a aposta no boss morto; closing publica `motivo` e
  `bossesVencedores`.

**Testes substituídos, registrados no próprio teste:** T-W01–T-W05, T-S11, T-S22, T-G05, o
caso de seleção da Weekly no T-S04, a parte Weekly do T-R14, T-Q03, T-F04, T-P05, o
`sem_vencedor` do T-F05, o 1º caso do T-Q05 e o caso "Weekly não aparece" das odds. As
fixtures de VOID do settlement e do closing trocaram o motivo `sem_kill` por
`mercado_cancelado` — o VOID continua no modelo; "sem kill" deixou de ser VOID.

### 30.3 Resultado

`pnpm test:db` **280/280**; `pnpm test`: shared **365**, api **897**, web 147; lint,
typecheck e build OK; banco de dev com o mesmo hash.

## 31. Revisão 11, milestone 2 — fontes da sessão (24/09/2026)

**Status: GREEN.** D-60, D-62, D-63 — **mudança de produto**, não correção.

### 31.1 RED

| Camada  | Onde                                                                   | RED                                                                                                                                                                                                                                                                                                                                              |
| ------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| banco   | `test/db/titan-bet/auditoria.db-spec.ts` — 17 (T-A16, T-A19, T-A08/11) | **RED real** contra `20260924020000_titan_bet_fontes_estrutura`: **7** × "recebido `aceito`" (report duplicado na fonte, report em fonte ausente/sem raid, sem raid sem motivo/officer, motivo fora de sem raid, report de fonte congelada). Uma 8ª falha era a fixture ainda usando a coluna `candidates`, removida — corrigida antes de contar |
| domínio | `auditoria.spec.ts`, `resultados.spec.ts` — 57                         | **RED** — 9 falhas: `resolverSessao` ainda devolvia `ambigua`; `consolidarPulls` ausente; `killDaSemana` ainda pedia revisão na 2ª kill                                                                                                                                                                                                          |
| HTTP    | `titan-bet.controller.spec.ts` — 84                                    | **RED** — 5 falhas: a rota `fontes/:session/sem-raid` não existia                                                                                                                                                                                                                                                                                |
| serviço | `auditar-fluxo.db-spec.ts`, `calculo.db-spec.ts` — 29                  | **RED** — 25 falhas: Auditar gravando uma referência por fonte, sem `declararSemRaid`, cálculo lendo um report só                                                                                                                                                                                                                                |

### 31.2 O que mudou

- **Banco:** `BetSourceResolution` = `automatica | ausente | sem_raid` (saíram `ambigua` e
  `escolha_officer`); a referência do report saiu da fonte para `BetAuditSourceReport`
  (uma linha por `titanbet*`, única por fonte); `candidates` removida; `noRaidReason`
  com CHECKs (sem raid exige motivo e officer; motivo só em sem raid). Trigger
  `titanbet_report_da_fonte`: report só em fonte automática, e imutável com a auditoria
  confirmada ou substituída.
- **Contratos:** fonte `{ session, resolution, reports[], motivoSemRaid,
resolvedByBattletag, resolvedAt }`; `declararSemRaidSchema { motivo }` no lugar de
  `escolherFonteSchema`.
- **Domínio:** `resolverSessao` — todos os `titanbet*` da sessão, por início; nenhum →
  ausente. `consolidarPulls` — mesma pull em dois reports (mesmo encounter, início
  absoluto a menos de `JANELA_DE_DUPLICATA_MS` = 10 s) conta uma vez; a janela vem do
  M0 §15.8 (cópias a 0,3–3,7 s; pulls legítimas a ≥ 46 s). `killDaSemana` — a primeira
  kill, em ordem cronológica (D-62).
- **Serviços:** Auditar grava todos os reports; `declararSemRaid` (só na ausente, com a
  auditoria em revisão; resolvida a última, `pronta`); cálculo lê todos os reports
  congelados, pula a sessão sem raid e consolida a timeline antes dos resultados.
- **HTTP/Yaak:** `POST …/auditorias/:auditId/fontes/:session/sem-raid` (204) no lugar de
  `…/escolher`.

**Testes substituídos, registrados no próprio teste:** T-A06 (unitário, banco e fluxo),
T-A12 do fluxo (escolha do officer) e o "dois ou mais → ambígua" do `resolverSessao`.

### 31.3 Resultado

`pnpm test:db` **284/284**; `pnpm test`: shared **367**, api **902**, web 147; format,
lint, typecheck e build OK; banco de dev com o mesmo hash. (O build do web só passou
depois de apagar `apps/web/.next/dev/types`, cache ignorado de um `next dev` antigo que
ainda apontava para `app/oauth/callback`, removida na TIT-148 — nada do Titan Bet.)

## 32. Revisão 11, milestone 3 — depositante e self-bet (24/09/2026)

**Status: GREEN.** D-55 e D-56 — **mudança de produto**, não correção.

### 32.1 RED

| Camada   | Onde                                               | RED                                                                                                                                                                                                    |
| -------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| contrato | `betting.spec.ts`, `betting-leitura.spec.ts` — 33  | **RED** — 4 falhas: Submeter ainda pedia `depositCharacterId`; `meuSlip` sem `depositCharacter`                                                                                                        |
| HTTP     | `titan-bet.controller.spec.ts` — 84                | **RED** — 2 falhas: o corpo novo do Submeter dava 400 no `ZodValidationPipe` antigo                                                                                                                    |
| serviço  | `apostas-fluxo`, `autorizacao`, `odds`, `e2e` — 39 | **RED** — 23 falhas: Submeter sem `depositCharacterId` recusado ("não é da conta"); Salvar aceitando First Death no personagem de elegibilidade e no alt; `meuSlip` sem o depositante por nome e realm |

### 32.2 O que mudou

- **Contrato:** `submeterSlipSchema = { depositCharacter: { name, realm } }` (estrito, sem
  região — `characterInputSchema`); `meuSlip.depositCharacter: { name, realm } | null` no
  lugar de `depositCharacterId`.
- **Depositante (D-55):** qualquer personagem. O nome + realm informado resolve pela
  **identidade** (`CharactersRepository.resolver`: `toCharacterKey` mantém o acento,
  `toRealmMatchKey` tira o separador), criando-a se o site nunca a viu, e o id fica
  congelado no slip pelo trigger de imutabilidade que já existia. **Não** usa o `toSlug`
  que a Regra 6 prevê para nome digitado: lá a tolerância evita perder um lookup; aqui não
  existe lookup que falhe — todo nome é aceito —, e a tolerância juntaria `Shrëwd` e
  `Shrewd` numa identidade só. Quem confere que o personagem é do apostador é o officer.
  Efeito aceito: um Submeter recusado depois de resolver deixa a identidade criada (é
  só uma linha de `Character`, sem vínculo nenhum).
- **Self-bet (D-56):** First Death recusado em qualquer personagem reconhecido como do
  apostador — no Salvar, os ligados à conta e o de elegibilidade; no Submeter, esses
  (relidos na transação que trava o rascunho) e o depositante informado.
- **Removido:** `personagemEDaConta` (D-02 deixou de restringir o depositante).
- **Yaak:** Submeter, Ler e Salvar.

**Testes substituídos, registrados no próprio teste:** T-S16 (parte do depositante: "não é
da conta → recusado" e o controle do alt) → T-S26; T-S15 → T-S27; o schema do Submeter.

Sem teste, por decisão (§3.18): D-58 — nada impede o officer de confirmar o próprio
depósito, e continua assim.

### 32.3 Resultado

`pnpm test:db` **291/291**; `pnpm test`: shared **370**, api **902**, web 147; format,
lint, typecheck e build OK; banco de dev com o mesmo hash.

## 33. Revisão 11, milestone 4 — acesso por rodada e "ver slip" (24/09/2026)

**Status: GREEN.** D-53 e D-57 — **mudança de produto**, não correção.

### 33.1 RED

| Camada   | Onde                                               | RED                                                                                                                                                                                                                                                            |
| -------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| contrato | `betting-leitura.spec.ts` — T-Z09                  | **RED** — 4 falhas: `slipDoOfficerSchema` não existia                                                                                                                                                                                                          |
| HTTP     | `titan-bet.controller.spec.ts` — 95                | **RED** — 11 falhas: 5 rotas da rodada barrando o ex-membro com slip (T-Z10); a rota `GET officer/slips/:slipId` inexistente (3 × 404 no lugar de 401/403, 2 do T-Z09); odds ainda chamadas com a conta (T-Z08, D-53b)                                         |
| serviço  | `apostas-fluxo.db-spec.ts`, `odds.db-spec.ts` — 44 | **RED** — 9 falhas reais: `contaTemSlipNaRodada` (2) e `verSlip` (5) inexistentes; ex-membro com rascunho ou com slip recusado barrado no Salvar (2). Uma 10ª era erro do próprio teste (`opcoesDe` devolve objeto, não lista) — corrigida, não conta como RED |

**Passaram antes da implementação, registrados como controle:** os dois T-Z11 de serviço
— "não salva nem submete" é o comportamento que já existia, e a leitura das odds sem conta
passava por acidente: `where: { userId: undefined }` o Prisma ignora, e a checagem antiga
achava qualquer bettor. O RED da D-53b é o HTTP. Também passou o "self-bet continua
valendo" do T-Z10, porque `ContaNaoElegivel` é subclasse de `ApostaRecusada` — pelo
motivo errado no RED, pelo certo no GREEN (a elegibilidade do slip entra em `proprios`).

### 33.2 O que mudou

- **Banco:** `BetEventType.slip_visualizado` (`20260924040000_titan_bet_slip_visualizado`).
- **Guard (D-53a):** `ApostadorDaRodadaGuard` nas rotas da rodada (odds, slip, salvar,
  submeter, closing): o `RosterGuard` mais quem **tem slip nesta rodada**, em qualquer
  estado. Membro passa sem consulta ao banco; outra rodada e o resto do site continuam
  403 para o ex-membro. O login já dá sessão `not_member` — nada mudou no auth.
- **Elegibilidade (D-53a, D-65):** sem personagem ligado no snapshot, vale o de
  elegibilidade de um slip da conta na rodada — quem saiu depois de ter slip edita,
  submete e começa outro depois de um recusado. **Limite:** quem saiu antes de ter slip
  não é reconhecido (spec, leitura 4).
- **Odds (D-53b):** `OddsService.daRodada(roundId)`, sem conta; quem vê é o guard.
  Salvar continua 403 fora do snapshot; Submeter sem rascunho, 422.
- **Ver slip (D-57):** `GET /internal/titan-bet/officer/slips/:slipId` (`OfficerGuard`)
  → `slipDoOfficerSchema`; leitura e `BetEvent` na mesma transação; rascunho → 409,
  inexistente → 404, sem registro. Nenhuma escrita no slip.
- **Yaak:** "Ver slip (officer)" novo; odds, slip, salvar, submeter e closing com o
  guard novo; a descrição do Confirmar atualizada para a D-61.

**Testes substituídos, registrados no próprio teste:** "sem personagem no roster → 403"
nas rotas do membro (agora: sem roster **e** sem slip); "conta fora do snapshot não vê
odds" (serviço e HTTP).

### 33.3 Resultado

`pnpm test:db` **302/302**; `pnpm test`: shared **374**, api **913**, web 147; format,
lint, typecheck e build OK; banco de dev com o mesmo hash.

## 34. Matriz TDD do frontend — preparação (24/09/2026)

**Status: PREPARADA, não iniciada.** Nenhuma decisão de produto nova apareceu nos
milestones 1–4. O que falta para o front são **contratos de leitura** que decorrem de
decisões já tomadas (D-21, D-36, D-45, D-53, D-57), e por isso entram antes, pelo mesmo
protocolo de TDD do backend. Pendência de produto que **não** bloqueia: D-07 × D-59
(restituição de expirado), que só afetaria uma ação do Officer Panel que hoje nem existe
na API.

### 34.1 F0 — contratos que faltam (API, antes de qualquer tela)

Hoje toda rota do membro exige `:roundId`, e as odds só trazem ids. Sem isto a tela não
sabe qual rodada abrir nem o nome de nada.

| ID    | Rota (proposta)                                          | Guard                               | O que responde                                                                                                                                                                                                                | RED esperado       |
| ----- | -------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| T-C01 | `GET /internal/titan-bet/rodadas`                        | sessão (membro **ou** dono de slip) | rodadas visíveis à conta: `{ roundId, cutoffAt, fase }` — membro vê todas (o Closing é da guilda, D-21); ex-membro, só as com slip dele (D-53a)                                                                               | rota inexistente   |
| T-C02 | `GET /internal/titan-bet/rodadas/:roundId`               | `ApostadorDaRodadaGuard`            | o cardápio legível: `cutoffAt`, fase, mercados `{ marketId, kind, boss: { roundEncounterId, nome, track } \| null }`, candidatos `{ characterId, name, realm, role }`, bosses de progressão, e `podeApostar` da conta (D-53b) | rota inexistente   |
| T-C03 | contrato `rodadaDoMembroSchema` (shared)                 | —                                   | estrito: nenhum stake, slip ou conta (§16.10)                                                                                                                                                                                 | schema inexistente |
| T-C04 | `GET /internal/titan-bet/officer/rodadas`                | `OfficerGuard`                      | todas as rodadas com fase, para o officer chegar à preparação, ao Auditar e ao Closing                                                                                                                                        | rota inexistente   |
| T-C05 | `GET /internal/titan-bet/officer/rodadas/:roundId/slips` | `OfficerGuard`                      | slips **submetidos** da rodada sem as escolhas (molde do `depositoPendenteSchema`): é a porta para o "ver slip" (D-57), que só então registra `BetEvent`                                                                      | rota inexistente   |

`fase` é derivada, não coluna nova: preparação → aberta → após o cutoff → auditada →
liquidada → Closing publicado. Isso sai dos estados que já existem.

### 34.2 F1 — superfície do membro (`/interno/bet`)

Componentes com vitest + Testing Library, como `loot/` e `mplus/`; o fetch é falso, e o
contrato é o do shared.

| ID     | Comportamento                                                                                                                   | Decisão       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| T-UI01 | a página deixa entrar o ex-membro com slip na rodada (não redireciona por `membership`, como `mplus/`); 403 da API → `/interno` | D-53a         |
| T-UI02 | membro fora do snapshot vê mercados e odds, sem os controles de aposta (`podeApostar = false`)                                  | D-53b         |
| T-UI03 | Weekly: um boss de progressão por aposta, cada boss com a própria odd                                                           | D-54          |
| T-UI04 | Salvar manda o rascunho inteiro; o 422 aparece com o motivo do backend, sem tradução                                            | D-27, D-28    |
| T-UI05 | First Death não oferece personagem do próprio apostador; se o backend recusar mesmo assim, o motivo aparece                     | D-56          |
| T-UI06 | Submeter pede o depositante por nome + realm, **sem região**, e mostra o total a depositar                                      | D-55, Regra 6 |
| T-UI07 | slip submetido fica só leitura: estado, depositante como informado, total; recusado mostra o motivo e permite começar outro     | D-27, D-34    |
| T-UI08 | depois do cutoff não há controle de edição; o horário vem de `cutoffAt`                                                         | R-06          |
| T-UI09 | odds: `null` aparece como "—"; o multiplicador é projeção, não promessa                                                         | §16.10        |
| T-UI10 | resultados: o Closing publicado, `sem_vencedor` com o motivo e os bosses vencedores da Weekly                                   | D-48, D-61    |
| T-UI11 | nenhuma tela do membro renderiza aposta de outra pessoa (o contrato estrito já impede; o teste confirma o que a tela mostra)    | D-36          |

### 34.3 F2 — Officer Panel

| ID     | Comportamento                                                                                                    | Decisão    |
| ------ | ---------------------------------------------------------------------------------------------------------------- | ---------- |
| T-UI20 | a navegação do Officer Panel some para quem não é officer — UX; o 403 da API continua sendo a regra (Regra 5)    | D-36       |
| T-UI21 | preparar a semana: encounters do catálogo, farm/progressão, mercados — sem marcação de Weekly                    | D-45, D-54 |
| T-UI22 | Ready com as recusas do backend (sem boss de progressão para a Weekly etc.)                                      | D-31       |
| T-UI23 | depósitos pendentes: confirmar; recusar exige motivo. O officer confirma o próprio depósito                      | D-34, D-58 |
| T-UI24 | "ver slip": abrir é uma ação explícita (cada abertura vira `BetEvent`), a tela é só leitura; rascunho → 409      | D-57       |
| T-UI25 | Auditar: fontes por sessão com todos os `titanbet*`; sessão ausente pede "não houve raid oficial" com motivo     | D-60, D-63 |
| T-UI26 | resultados calculados, `sem_vencedor` com motivo; confirmar liquida (ação que mexe em dinheiro, com confirmação) | D-61       |
| T-UI27 | saldos, pagar e ajustar, com as recusas do ledger                                                                | D-44       |
| T-UI28 | publicar o Closing Report                                                                                        | D-48       |

### 34.4 Ordem

F0 (T-C01–T-C05, API, com Yaak) → F1 → F2. Cada item F1/F2 é uma leitura dos contratos
F0 e dos existentes; nenhum inventa campo que o shared não tenha (Regra 2). Antes de
escrever a primeira tela: ler `node_modules/next/dist/docs/` (CLAUDE.md, aviso do Next 16).
