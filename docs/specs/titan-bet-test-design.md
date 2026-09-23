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
| T-W05 | OQ-47       | K ∩ encounters configurados                                    | —                                                                        | OQ-47                   | OQ-47                   |
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
| T-C04 | OQ-51              | identidade exibida do vencedor                                                          | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-51**  | OQ-51         |
| T-X01 | OQ-30              | avisos no Discord                                                                       | —                    | —                                                                                                                            | —                                                 | —                                                               | **BLOCKED BY OQ-30**  | OQ-30         |

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

M0 #1, #2 e #6 são gates **antes de ligar settlement automático em produção**. Não viram
teste artificial. Os testes abaixo usam logs **fictícios** e provam o algoritmo; o gate
prova que os números do WCL real batem com a tela.

| Gate | O que falta                                                   | Testes cujo resultado em produção depende dele |
| ---- | ------------------------------------------------------------- | ---------------------------------------------- |
| #1   | comparação humana das seis métricas de farm com a tela do WCL | T-F01, T-F02, T-F08                            |
| #2   | comparação humana do First Death das tries com a tela do WCL  | T-F05, T-P01–T-P05                             |
| #6   | tempo até o Parse % ficar disponível numa raid real           | T-F06, T-F08                                   |

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
| RED/GREEN Resultados  | farm, progressão, Weekly                                                                                                                          | T-F01–T-F06, T-P01–T-P05, T-W01–T-W04                                                                                                        |
| RED/GREEN Settlement  | rateio e ledger                                                                                                                                   | T-M01–T-M08, T-L04–T-L07                                                                                                                     |
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
