# Titan Bet — especificação técnica

> **Status: RASCUNHO, nada implementado.** Escrita em 23/09/2026 contra `origin/main`
> (`0beccec`), na branch `feat/titan-bet`. Sem issue no Linear por decisão explícita.
>
> **Revisão 2 (23/09/2026):** incorpora as decisões de produto sobre acesso, depósito,
> alvo, candidatos, `VOID`, Weekly Progression, settlement, expiração, arredondamento,
> correção pós-pagamento, self-bet e odds. As OQs resolvidas saíram da lista de
> pendências e estão registradas na §2. O M0 foi reescopado (§14).
>
> **Revisão 9 (23/09/2026):** Parse % é a coluna da tela do WCL, capturada no Auditar e
> congelada (D-43, resolve a parte de parse da OQ-25); mercado com resultado e nenhuma
> aposta vencedora redistribui o prize pool (D-44, OQ-57); preparação da semana pelo
> Officer Panel (D-45); M0 #6 deixa de ser gate (D-46).
>
> **Revisão 8 (23/09/2026):** desenho da OQ-53 aprovado como está (D-38), banco de teste
> isolado `titan_test` aprovado (D-41), regras de RED sem encenação (D-42), OQ-56 nova.
> Matriz, milestones TDD e baseline em `docs/specs/titan-bet-test-design.md`.
>
> **Revisão 7 (23/09/2026):** OQ-53 resolvida — o snapshot de bettors passa a ser de
> **personagens** do roster da guilda, e a conta se associa depois (D-38); triggers
> aprovadas (D-39); TDD estrito obrigatório (D-40). Matriz de testes em
> `docs/specs/titan-bet-test-design.md`.
>
> **Revisão 6 (23/09/2026) — final do desenho:** Ready com configuration freeze atômico,
> snapshots separados de bettors e candidates, slip recusado terminal com novo slip antes
> do cutoff, Officer Panel exclusivo, CHECK/índice parcial/triggers no PostgreSQL, e a
> revisão final do schema do M2 (§16). **M2 schema design ready for implementation.**
>
> **Revisão 5 (23/09/2026):** o Titan Bet é **semanal** — mercados e settlement pertencem à
> rodada; terça e quinta são só evidência. Decisões D-27 a D-30 (slip único com Salvar ×
> Submeter pagamento, uma Bet por mercado com 0..N escolhas na Weekly, mercados semanais,
> Auditar) e **desenho conceitual do M2** (§16).
>
> **Revisão 4 (23/09/2026):** decisões D-19 a D-26 (só terça/quinta, mercados definidos
> por officers, pagamento agregado e apostas secretas, catálogo do WCL, report oficial
> ausente/múltiplo/após a meia-noite), freeze, Round Closing Report e boundary de
> privacidade. Nenhuma OQ restante impede desenhar o schema (§13).
>
> **Revisão 3 (23/09/2026):** decisões D-13 a D-18 (elegibilidade × participação, mortes
> simultâneas, seleção vazia, `VOID` confirmado por officer, congelamento no cutoff,
> report oficial `titanbet*`) e **resultado do M0** (§15).
>
> Este documento separa quatro coisas, e a separação é o ponto:
>
> - **REQUISITO (R-xx)** — o que foi pedido originalmente, sem acréscimo.
> - **DECISÃO (D-xx)** — resposta de produto a uma OQ. Tem a mesma força de requisito.
> - **PROPOSTA** — como encaixar requisito e decisão na arquitetura. Pode ser trocada.
> - **OPEN QUESTION (OQ-xx)** — o que continua indefinido. **Nenhuma foi respondida por
>   conta própria.** Os números das OQs são os da revisão 1, para manter rastreio.
>
> Afirmações sobre o que a API do Warcraft Logs devolve **além do que o código já usa**
> foram verificadas no M0 (§15). A §15 é a fonte; onde ela diverge de uma suposição
> anterior deste documento, ela vence.

---

## 0. Vocabulário

Quatro fontes de "quem" existem no sistema, e confundi-las é o erro mais provável desta feature.

| Termo                | O que é no código                                                                                                                            | Usado para                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Titan Roster**     | o **time de raid** curado no WoWAudit: `WowAuditService.getTeamCharacters()`, exibido em `/interno/roster` via `RosterService.getRaidTeam()` | **candidatos** das apostas (D-04)               |
| roster da guilda     | o roster da Blizzard: `BlizzardService.getGuildRosterSnapshot()`, ~590 personagens                                                           | quem é membro; o que o `RosterGuard` checa      |
| personagens da conta | `GuildCharacter`: personagens do roster da guilda **já ligados** a uma conta, descobertos no login                                           | personagem depositante (D-02) e self-bet (D-09) |
| lineup da luta       | quem aparece numa fight do report `titanbet*` no Warcraft Logs                                                                               | **resultado**; nunca candidato (D-13)           |

Duas palavras que não se misturam: **elegibilidade** (candidate eligibility) é o Titan
Roster congelado no **Ready** (D-31, D-33); **participação** (actual participation) é o WCL.
Participação **nunca** altera elegibilidade retroativamente.

"Titan Roster" não é um nome que existe no código hoje; é este documento que o fixa como
o time do WoWAudit, porque é a lista que a guilda chama de roster na área interna. O
`RosterGuard` tem "roster" no nome e **não** tem relação com ele.

Termos do produto usados abaixo:

- **Bet Slip** — o conjunto de apostas que um membro fecha e deposita de uma vez.
- **Aposta válida** — aposta de slip **confirmado** por officer, em mercado **não** `VOID`.
  É a única que entra em pool, odds e receita da guilda.
- **Opção** — o que se aposta dentro de um mercado: um personagem, ou (Weekly Progression)
  um conjunto exato de bosses.
- **Pool válida (`V`)** — soma do gold das apostas válidas de um mercado.
- **Prize pool (`P`)** — a parte de `V` que vai para os vencedores (§8).

---

## 1. Requisitos originais

### Produto

- **R-01** Funcionalidade exclusiva da área de membros. _(precisado por D-01)_
- **R-02** Membros apostam gold do WoW em resultados das raids Mythic da Titan.
- **R-03** O gold se move **dentro do jogo**. O site registra apostas, validações,
  resultados e pagamentos.

### Calendário

- **R-04** Sexta-feira: abertura das apostas da nova rodada.
- **R-05** Sexta a segunda: período normal para criar Bet Slips e depositar.
- **R-06** Terça 12:00: cutoff. Slips não confirmados **expiram**. _(precisado por D-07)_
- **R-07** Raids oficiais: terça e quinta.
- **R-08** Sexta: settlement/pagamentos da rodada anterior e abertura da próxima.

### Validação

- **R-09** O membro faz várias apostas e fecha tudo num Bet Slip.
- **R-10** O site informa o total de gold a depositar no Guild Bank.
- **R-11** O slip nasce `PENDING_DEPOSIT`.
- **R-12** Um officer confere o depósito no Guild Bank **à mão**. Não existe integração
  automática com o Guild Bank.
- **R-13** O officer confirma o slip **inteiro**.
- **R-14** Só slips confirmados entram nas pools.
- **R-15** Registrar qual officer confirmou e quando.

### Valores

- **R-16** Cada aposta individual: de 200g a 1.000g, gold inteiro.
- **R-17** Mercado liquidado normalmente: 10% da pool válida pertence ao Guild Bank.
- **R-18** 90% forma a prize pool.
- **R-19** A prize pool é dividida entre as apostas vencedoras, proporcional ao gold
  individual apostado.
- **R-20** **Não existe desempate artificial.** Quando duas ou mais opções satisfazem
  igualmente a condição vencedora, todas são resultados verdadeiros, e o rateio considera
  todas as apostas feitas em todas elas.

### Escopo

- **R-21** Só raids e bosses **Mythic**.

### Mercados — boss farm (Mythic já morto antes pela Titan)

- **R-22** Top DPS · Top DPS Parse % · Top HPS · Top HPS Parse % · Top Dispels · First Death.
- **R-23** Resultado derivado da kill Mythic válida considerada para aquela rodada.

### Mercados — boss em progressão (Mythic ainda não morto pela Titan)

- **R-24** Só First Death.
- **R-25** Só pulls Mythic efetivamente registrados no Warcraft Logs. _("naquela raid
  night" corrigido para a semana pela D-29)_
- **R-26** Por pull válido, registrar apenas o **primeiro personagem da Titan** a morrer.
- **R-27** Soma quantas vezes cada personagem foi First Death **na semana**; vence a maior
  contagem; empate produz vários vencedores. _("ao fim da noite" corrigido pela D-29)_
- **R-28** Boss sem pull válido nos reports oficiais da semana não produz resultado.
  _(corrigido pela D-29)_
- **R-28a** A lista de cada try e o seu First Death é preservada como evidência.

### Weekly Progression

- **R-29** Aposta semanal separada.
- **R-30** O membro seleciona os bosses Mythic que acha que a Titan mata naquela semana.
- **R-31** A seleção inteira é **uma** aposta, não uma por boss.
- **R-32** O resultado são os bosses Mythic efetivamente mortos naquele reset.
  _(precisado por D-05)_

### Odds

- **R-33** Elemento social/divertido, refletindo como a própria guilda aposta.
- **R-34** Nunca apresentadas como probabilidade estatística nem como payout garantido.
- **R-35** Enquanto o mercado está aberto, a tela pode mostrar um multiplicador dinâmico
  ("Projected payout: 3.42×"): o retorno se a pool fechasse naquele momento. Ele muda
  conforme entram apostas válidas.

### Fonte

- **R-36** Warcraft Logs é a fonte dos resultados objetivos sempre que possível.

---

## 2. Decisões de produto (23/09/2026)

| D    | Resolve         | Decisão                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-01 | OQ-01           | Qualquer membro confirmado da guilda acessa: **`RosterGuard`** nas rotas member-facing. Validação de depósito, settlement, correções e pagamento: **`OfficerGuard`**.                                                                                                                                                                                                                |
| D-02 | OQ-04 (parcial) | Ao finalizar o slip, o membro **seleciona qual personagem dele** fará o depósito. O slip registra personagem depositante, valor total esperado, membro dono e estado da validação. O officer confere personagem e valor no Guild Bank e confirma o slip inteiro. O que continua aberto está em OQ-04a.                                                                               |
| D-03 | OQ-10           | Alvos são **personagens**, não pessoas. Resultados do WCL são associados ao personagem correspondente.                                                                                                                                                                                                                                                                               |
| D-04 | OQ-11           | Candidatos vêm **exclusivamente do Titan Roster**. Top DPS e Top DPS Parse %: personagens DPS. Top HPS e Top HPS Parse %: personagens Healer. Top Dispels: qualquer personagem do Titan Roster. First Death: qualquer personagem do Titan Roster, menos self-bet (D-09). Candidato que não participou da luta não pode vencer. O WCL **não** define candidatos; só resultados.       |
| D-05 | OQ-17           | Weekly Progression vence só com **correspondência exata**: boss marcado que não morreu → perde; boss não marcado que morreu → perde.                                                                                                                                                                                                                                                 |
| D-06 | OQ-15, OQ-14    | Mercado sem vencedor válido fica **`VOID`**: sem resultado verificável, raid cancelada, mercado cancelado, impossibilidade técnica, **nenhuma opção elegível produz resultado vencedor** (é o caso da OQ-14, kill sem morte de candidato). Aposta em mercado `VOID` não perde, não entra em payout, não gera os 10% e gera **gold devido de volta**. Restituição manual e auditável. |
| D-07 | OQ-20           | Sem hard delete. Slip não confirmado no cutoff vai para estado terminal equivalente a `EXPIRED`: não entra em pool, não afeta odds, não gera receita e **nunca** pode ser confirmado depois. Se houve depósito real, dá para registrar gold devido de volta.                                                                                                                         |
| D-08 | OQ-19           | O sistema calcula resultados do WCL automaticamente, mas **settlement só é definitivo e pagável com confirmação de officer**. Fluxo conceitual mínimo: `CALCULATED → CONFIRMED → PAID`. Evidência suficiente para auditoria posterior.                                                                                                                                               |
| D-09 | OQ-27           | Nos mercados **First Death**, o apostador não pode apostar no próprio personagem. Nos outros mercados, pode. A ambiguidade de "próprio personagem" está em OQ-27a.                                                                                                                                                                                                                   |
| D-10 | OQ-23           | Toda contabilidade em **gold inteiro**, sem silver/copper. Resíduos indivisíveis do rateio ficam para o Guild Bank. Arredondamento determinístico com `Σ payouts ≤ prize pool` (§8.2).                                                                                                                                                                                               |
| D-11 | OQ-24           | Settlement `PAID` **nunca** é recalculado nem alterado automaticamente. Correção exige ação administrativa explícita, preservando valor calculado, valor pago, motivo, officer, timestamp e o ajuste.                                                                                                                                                                                |
| D-12 | OQ-21           | Odds e projected payout contam **só apostas válidas** (§8.4).                                                                                                                                                                                                                                                                                                                        |

### Revisão 3 (23/09/2026)

| D    | Resolve | Decisão                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-13 | OQ-13   | **Elegibilidade ≠ participação.** Candidato = personagem do Titan Roster **congelado** da rodada. Participar da raid, noite ou luta **não** é requisito para ser opção; replaces, faltas e lineup não mudam a lista. O WCL diz depois quem produziu resultado. No First Death, **só mortes de personagens do Titan Roster congelado contam**: morte de outsider (replace excepcional) é ignorada, e segue-se para a próxima morte até achar a primeira elegível.                                         |
| D-14 | OQ-16   | Duas ou mais mortes **elegíveis** com **exatamente** a mesma timestamp, na precisão que o WCL fornece, são **todas** First Death daquela try. Em progressão, cada personagem empatado ganha um First Death naquela try.                                                                                                                                                                                                                                                                                  |
| D-15 | OQ-17a  | Weekly Progression aceita **qualquer** subconjunto dos bosses Mythic da raid atual — farm, progressão, mistura, e **o conjunto vazio**. `{}` é a previsão "a Titan não mata nenhum boss Mythic neste reset" e vence só se não houver nenhuma kill Mythic; qualquer kill Mythic a derruba. Correspondência exata continua valendo (D-05).                                                                                                                                                                 |
| D-16 | OQ-31   | O sistema pode **propor** `VOID` automaticamente, mas `VOID` é parte do settlement e só é definitivo com **confirmação de officer**, como o resultado (D-08).                                                                                                                                                                                                                                                                                                                                            |
| D-17 | OQ-32   | Os candidatos da rodada **congelam no cutoff** de terça 12:00, a partir do Titan Roster (WoWAudit, `/interno/roster`). Mudança posterior no Titan Roster não altera a rodada. O lineup do WCL **nunca** altera candidatos.                                                                                                                                                                                                                                                                               |
| D-18 | —       | **Report oficial.** Para cada raid night apurada existe **um** report do WCL destinado ao Titan Bet: publicado nos logs da guilda, da data/noite oficial da raid, com título começando por `titanbet` (comparação **case-insensitive**; qualquer coisa depois do prefixo é permitida). Só ele é fonte de settlement. Nenhum outro report é escolhido por ter fights parecidas, o mesmo encounter ou horário próximo. Contrato: `Raid Night → report titanbet* → fights/pulls → resultados → settlement`. |

Confirmações, registradas para não serem reabertas sem incompatibilidade técnica concreta:

- **OQ-14** — mercado sem vencedor elegível pode resultar em `VOID`, pelas regras de
  settlement (D-06, D-16).
- **OQ-21** — odds e projected payout contam só apostas **válidas** (D-12).
- **Self-bet** — proibido nos **dois** mercados First Death, farm e progressão (D-09).
- **Candidatos** — replaces, faltas e lineup real não alteram a lista congelada (D-13, D-17).

### Revisão 4 (23/09/2026)

| D    | Resolve | Decisão                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-19 | OQ-08   | **Só terça e quinta.** Só as raids oficiais de terça e de quinta valem, e só com o report oficial `titanbet*`. Raid de qualquer outro dia não faz parte do Titan Bet — nem Mythic, nem oficial para a guilda, nem no WoWAudit, nem com log, nem com `titanbet` no título. Report de terça/quinta fora do contrato `titanbet*` não é usado automaticamente.                                                                                      |
| D-20 | OQ-09   | **Mercados definidos por officers.** Qualquer officer configura e altera enquanto a rodada permite edição: quais bosses, quais mercados por boss, configuração da Weekly Progression. Nada de mercado de farm aberto automaticamente porque o boss já morreu. O sistema pode sugerir; o publicado pelo officer é a fonte de verdade. No cutoff, congela; depois, nada muda em silêncio.                                                         |
| D-21 | OQ-26   | **Pagamento agregado por membro por rodada**, com ledger interno por mercado que explica o total. Registrar membro, total, composição, officer que marcou pago e horário. **Round Closing Report** com resultados e valores ganhos por membro por mercado. **Apostas são secretas**: o relatório não publica stake, opção escolhida, apostas perdedoras, slips nem histórico. Separar `private betting data` de `published settlement results`. |
| D-22 | OQ-35   | **Sem "raid atual" própria.** O officer escolhe entre os encounters do tier no **catálogo do WCL**, pelos identificadores estáveis. O que ele seleciona é o escopo da rodada. Continua valendo o filtro de catálogo do `toRaidPulls` — `difficulty = 5` sozinho não identifica raid Mythic.                                                                                                                                                     |
| D-23 | OQ-36   | **Outros dias não existem** para o Titan Bet. Sem configuração de raid extraordinária, sem override de dia, sem exceção administrativa, sem descoberta automática. Calendário válido: `terça + quinta`, somente.                                                                                                                                                                                                                                |
| D-24 | OQ-37   | **Sem `titanbet*`, sem fonte.** Não escolher outro report. Não é "nenhuma kill", "nenhum resultado", Weekly Progression vazio nem `VOID` automático. Nada de fallback silencioso. Exige resolução administrativa, com fluxo a detalhar (OQ-45).                                                                                                                                                                                                 |
| D-25 | OQ-38   | **Vários `titanbet*`: officer escolhe.** O sistema não escolhe. Registrar report escolhido, officer e horário. Só o selecionado entra no cálculo da noite.                                                                                                                                                                                                                                                                                      |
| D-26 | OQ-41   | **O report é o boundary da sessão.** Virar a data civil não encerra a raid: fight após 00:00 no mesmo report oficial continua sendo da terça (ou da quinta). Nunca dividir por `DATE(timestamp)`. A elegibilidade da noite é a da sessão/report iniciado na terça ou quinta válida.                                                                                                                                                             |

Também da revisão 4:

- **Freeze** no cutoff de candidatos, bosses, mercados, configuração da Weekly Progression
  e slips válidos (§5.4).
- **Weekly Progression** só com kills dos reports oficiais das noites válidas (§7.3).
- **Gates de produção:** M0 #1, #2 e #6 não bloqueiam M1 nem o desenho do M2, mas
  **bloqueiam habilitar settlement automático em produção** (§14).
- **Achados fora do Titan Bet** ficam como findings separados, sem correção aqui (§12).

### Revisão 5 (23/09/2026) — o Titan Bet é semanal

**Princípio central.** A unidade de aposta **e** de settlement é a `BetRound`, a semana do
reset. Terça e quinta **não** têm mercados nem pools próprios: são duas sessões que
fornecem **evidência** para auditar os mesmos mercados semanais.

```
BetRound semanal → mercados semanais → reports oficiais de terça + quinta → auditoria
→ resultados → settlement → payout
```

`Boss A — Top DPS` é **um** mercado da rodada. Não existem `terça / Boss A / Top DPS` e
`quinta / Boss A / Top DPS`. O lockout Mythic é semanal: se o Boss A morre na terça, não
morre de novo na quinta.

| D    | Resolve | Decisão                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-27 | OQ-05   | **Um Bet Slip por membro por rodada**, com duas ações distintas. **Salvar** persiste o rascunho e mantém o slip editável: adicionar, remover e alterar apostas, opções e stakes. **Submeter pagamento** valida o slip inteiro, congela total, personagem depositante, apostas e escolhas, e muda para `PENDING_DEPOSIT`; dali em diante o membro não altera nada. Officer confirma → `VALID`; cutoff sem confirmação → `EXPIRED`. Não é possível criar outro slip para contornar a imutabilidade.                                                                                                                                                                                                                    |
| D-28 | OQ-29   | **Uma Bet por membro por mercado**, alterável enquanto o slip é editável. Mercado de escolha simples (Top DPS, Top HPS, os dois Parse %, Top Dispels, First Death): **exatamente uma** escolha. Weekly Progression: **uma** Bet com **0..N** bosses — três bosses são uma aposta com três escolhas, não três apostas; zero é "nenhum boss morre". Escolhas modeladas relacionalmente, não em JSON genérico.                                                                                                                                                                                                                                                                                                          |
| D-29 | OQ-44   | **Todos os mercados são semanais.** Farm: um conjunto de mercados por boss na semana; a kill da terça dá o resultado, ou a da quinta se não morreu na terça; sem kill válida nos reports oficiais, valem as regras de resultado/`VOID`. **First Death de progressão também é semanal**: soma os First Deaths elegíveis de todas as pulls válidas dos reports oficiais da semana (terça A 3, B 2; quinta A 1, B 3 → A 4, B 5 → B vence). Weekly Progression pertence à rodada.                                                                                                                                                                                                                                        |
| D-30 | OQ-42   | **Auditar.** Depois da raid de quinta, o officer aciona **Auditar**: o sistema identifica a rodada, procura nos logs da guilda os reports `titanbet*` (case-insensitive) das sessões válidas, associa à terça e à quinta, valida que a seleção é inequívoca e só então calcula. **Happy path:** encontrou exatamente o esperado → usa sozinho, sem seleção manual, e registra reports, horário da auditoria e officer. **Ausência:** não usa report fora do contrato, não assume que não houve raid nem zero kills, não faz settlement — pede revisão do officer. **Múltiplos candidatos:** não escolhe; apresenta ao officer e registra a decisão. Seleção manual é fallback de ambiguidade, não etapa obrigatória. |

Correções que a revisão 5 impõe a textos anteriores:

- **R-25, R-27 e R-28** diziam "naquela raid night" e "ao fim da noite". Pela D-29, o
  First Death de progressão é **semanal**: pulls de terça **e** quinta, contagem somada.
  "Boss sem pull não gera resultado" passa a ser "sem pull válido nos reports oficiais da
  **semana**".
- **D-25** (vários `titanbet*` → officer escolhe) continua valendo, agora como a exceção
  de ambiguidade dentro do Auditar (D-30).
- **Dois freezes distintos**: o do **slip**, em "Submeter pagamento" (D-27), e o da
  **rodada**, no cutoff (§5.4). Não se misturam.

### Revisão 6 (23/09/2026) — Ready, snapshots, recusa e Officer Panel

Estas decisões substituem qualquer regra anterior incompatível.

| D    | Resolve             | Decisão                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-31 | OQ-49, OQ-43, OQ-33 | **Ready.** A rodada nasce em `PREPARATION`: officers configuram encounters, farm/progressão, mercados e Weekly Progression; membros **não** apostam; mercados podem ser alterados e removidos. Um officer executa **Ready**, a qualquer momento antes do cutoff de terça (sem dia fixo), e ele, **atomicamente**: valida a configuração, lê as fontes externas, congela o snapshot de **bettors** e de **candidates** (com a role), congela encounters, farm/progressão, mercados e Weekly Progression, registra quem e quando, e **abre** as apostas. Se qualquer passo falhar — inclusive fonte stale —, nada é gravado e a rodada continua em `PREPARATION`. Depois do Ready a configuração é **imutável**: sem adicionar, remover ou alterar mercado, encounter, farm/progressão, candidato ou bettor. Sem versionamento de mercado no MVP. |
| D-32 | —                   | **Snapshot de bettors.** O Ready congela **quem pode apostar** na rodada — a população ampla de membros elegíveis da guilda. "Este membro pode apostar nesta rodada?" consulta o snapshot, nunca a fonte externa: quem entra na guilda depois não ganha elegibilidade, mudança posterior de roster não altera, login posterior não recalcula, e não existe refresh. É autorização **de domínio**, separada do guard de acesso ao site.                                                                                                                                                                                                                                                                                                                                                                                                          |
| D-33 | —                   | **Snapshot de candidates.** O Ready congela os candidatos a partir do Titan Roster (WoWAudit, `/interno/roster`), com a role de cada um naquele momento. Depois disso nada os redefine: falta, replace, lineup, participação no WCL, mudança de role ou no WoWAudit. **Bettors e candidates são populações diferentes**: estar no Titan Roster não é requisito para apostar.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D-34 | OQ-06               | **Recusa de depósito.** `PENDING_DEPOSIT → REJECTED`, **terminal**: não volta a rascunho, não edita, não ressubmete, não entra em pool, fica para auditoria. Antes do cutoff, com a rodada aberta, o membro pode criar um **novo** slip, que nasce `DRAFT`; o recusado nunca é reutilizado. A regra passa a ser **no máximo um slip ativo por membro por rodada**, não um slip por membro por rodada — o histórico de recusados fica.                                                                                                                                                                                                                                                                                                                                                                                                           |
| D-35 | OQ-02               | **Cutoff (terça 12:00)** encerra as ações de aposta: não cria slip, não edita rascunho, não submete, e um recusado não gera nova tentativa. `PENDING_DEPOSIT` não confirmado → `EXPIRED`; `VALID` continua válido. Cutoff não é configuration freeze — esse já aconteceu no Ready. Antes do cutoff, com a rodada aberta, apostar é permitido em qualquer dia, inclusive terça de manhã.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D-36 | —                   | **Duas superfícies.** O membro elegível tem a superfície de apostas: mercados, candidatos, projected payout de todos os mercados publicados, o próprio slip (salvar, voltar, submeter, acompanhar) e, depois, os resultados. O **Officer Panel** é exclusivo de officers, com autorização no backend (o `OfficerGuard`); esconder a navegação no front é complemento, nunca substituto. Um membro nunca vê a aposta de outro.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D-37 | —                   | **Mecanismos no PostgreSQL aprovados:** CHECK constraints para regras locais a uma linha (stake 200–1.000, coerência estrutural da Bet, campos obrigatórios por estado); **índice único parcial** para "no máximo um slip ativo"; **append-only reforçado no banco** para o ledger, não só no service. Regra multi-linha complexa não vai para CHECK.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Consequências para textos anteriores:

- **D-17 e D-20 mudam de momento:** candidatos e configuração congelam no **Ready**, não
  no cutoff.
- **O configuration freeze saiu do cutoff e foi para o Ready.** O cutoff agora só encerra
  as ações de aposta. §5.4 da revisão 5 está substituída pela §5.4 abaixo.
- **OQ-49 deixa de existir:** antes do Ready ninguém aposta, então remover mercado não
  atinge aposta nenhuma; depois do Ready, mercado não muda.
- **OQ-33 deixa de existir:** os candidatos congelam no Ready, antes da primeira aposta.
- **OQ-43**, na parte de configuração, está respondida: nada muda depois do Ready. O que
  sobra de correção pós-freeze é sobre **resultado e dinheiro**, e já tem caminho (nova
  auditoria antes da confirmação; `ajuste` no ledger depois — D-11).

### Revisão 7 (23/09/2026) — identidade do bettor, triggers e TDD

| D    | Resolve | Decisão                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-38 | OQ-53   | **Elegibilidade é do estado da guilda no Ready, não do histórico de login.** Membro elegível no Ready entra no snapshot mesmo sem nunca ter logado; o primeiro login pode vir depois e **associa** a conta à identidade já congelada. A associação não muda quem era elegível: nenhum bettor entra, nenhum sai. O snapshot não pode exigir `userId` existente no Ready.                                                                                                                                                                                                                          |
| D-39 | —       | **Triggers aprovadas** para o que CHECK, UNIQUE, FK e índice parcial não alcançam: configuração imutável depois do Ready, snapshots imutáveis, slip só em rodada aberta e antes do cutoff, transições do slip, Bet editável só em rascunho, resultado imutável depois de confirmado, append-only do ledger (`BEFORE UPDATE OR DELETE FOR EACH ROW` + `BEFORE TRUNCATE FOR EACH STATEMENT`, com exceção) e das estruturas históricas que precisarem. A aprovação **não** é para trigger em toda regra: cada invariante vai para o mecanismo mais simples e forte, sem duplicar camada sem motivo. |
| D-40 | —       | **TDD estrito:** `Specification → Test Design → RED → Implementation → GREEN → Refactor`. Nenhum comportamento testável do Titan Bet sem RED antes. RED válido falha **porque o comportamento não existe** — não por sintaxe, import acidental, fixture inválida, runner mal configurado ou infraestrutura fora do ar. Para chegar ao GREEN é proibido enfraquecer assertion, remover cenário, trocar o esperado, skipar ou mockar a regra testada; se a spec precisar mudar, para e registra antes.                                                                                             |

**Identidade do bettor (D-38), a partir do que o repositório já tem:**

- A fonte de membership é o **roster da Blizzard** (`BlizzardService.getGuildRosterSnapshot()`),
  que devolve personagens (`name`, `nameKey`, `realmSlug`, `rank`) — não contas. Contas
  só aparecem no login, pelo OAuth.
- A identidade estável que existe **antes** do login é **`Character`** (`nameKey` +
  `realmKey`, nunca apagada). O Ready consegue resolvê-la para o roster inteiro com
  `CharactersRepository.resolverDoRoster`, sem conta nenhuma.
- A associação conta ↔ personagem já existe: `GuildCharacter` (`characterId` único → uma
  conta por personagem), criado no login.
- Portanto o snapshot de bettors passa a ser **por personagem**: `BetRoundBettor(roundId,
characterId)`. "Esta conta pode apostar nesta rodada?" = a conta tem um personagem
  associado que está no snapshot. O slip grava **qual** personagem deu a elegibilidade
  (§16.2), e é isso que responde historicamente por uma conta que apostou.
- **Limite conhecido, não bloqueador:** `Character` é nome + realm. Personagem renomeado
  ou transferido entre o Ready e o login vira outra identidade e não casa com o snapshot
  naquela semana. O roster da Blizzard também tem um id numérico de personagem, mas o
  serviço atual o descarta e `Character` não o guarda — usá-lo seria mudança fora do Titan
  Bet, não necessária para o M2.

### Revisão 8 (23/09/2026) — aprovação da OQ-53, banco de teste e RED

| D    | Resolve | Decisão                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —    | OQ-53   | **O desenho da D-38 está aprovado como está**: roster da Blizzard → `Character` → `BetRoundBettor(roundId, characterId)` com rank, nome e realm; `GuildCharacter` associa a conta depois; `BetSlip.eligibilityCharacterId`; um slip ativo por conta. O id numérico da Blizzard **não** entra agora. Rename/transfer entre o Ready e o primeiro login pode fazer a associação daquela semana falhar — limitação documentada, **não** bloqueia o M2, e não se resolve fora do escopo do Titan Bet.                       |
| D-41 | —       | **Banco de teste isolado `titan_test`**, com configuração separada, runner próprio (`*.db-spec.ts`), proteção contra rodar com URL de dev/prod, e CI capaz de usá-lo no futuro. Nunca teste destrutivo no banco de dev. Isolamento por dado (cada teste com sua rodada), sem depender de truncar — o ledger não permite. Tempo pelo dado (`cutoffAt` futuro/passado), **sem** bypass, relógio especial ou `NODE_ENV === 'test'` em trigger. Desenho: `titan-bet-test-design.md` §1.2.                                  |
| D-42 | —       | **Não fabricar RED.** Proibido: implementação propositalmente errada, controller sem `OfficerGuard` para provar acesso, constraint removida de propósito, assertion artificial, stub `not implemented` como evidência principal. Domínio: estrutura mínima legítima, ou **`RED awaiting implementation seam`**. Banco: migration incremental (estrutura → RED → regra → GREEN). Autorização: teste antes da primeira rota real. Guardas estruturais são regressão, não RED. Baseline registrado antes do primeiro RED. |

### Revisão 9 (23/09/2026) — Parse %, `W = 0`, preparação da semana e gates

| D    | Resolve             | Decisão                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-43 | OQ-25 (parte parse) | **Parse % é exatamente o valor da coluna "Parse %" da tabela do Warcraft Logs** — se a tela mostra `98`, o valor é `98`. Nunca o `ilvl %` (o `bracketPercent`). Qual campo/variante da API reproduz a coluna é verificação técnica (gate #1, §14). O valor que vale é o disponível **no momento em que o officer dispara Auditar**, e fica congelado na evidência: recálculo ou mudança posterior do WCL não altera resultado já auditado.                                                                                                                                             |
| D-44 | OQ-57               | **Mercado com resultado válido e nenhuma aposta vencedora (`W = 0`) não é `VOID` e não restitui.** Os 10% (`G₀`) continuam do Guild Bank. Os 90% (`P`) desse mercado são **distribuídos igualmente entre os demais mercados premiáveis da mesma rodada**, somando ao prize pool deles; o resto indivisível em gold vai para o Guild Bank (regra geral do arredondamento, D-10). **Premiável** = mercado com resultado `vencedores` e `W > 0`; `VOID` não recebe. Se **não existir nenhum outro mercado premiável**, o caso **não tem regra**: o settlement para e pede decisão (§8.6). |
| D-45 | —                   | **Preparar a semana é do Officer Panel.** Antes do Ready, o officer cria a `BetRound`, escolhe os encounters da semana (catálogo do WCL, D-22), classifica cada um como farm ou progressão, escolhe os mercados disponíveis e marca quais encounters participam da Weekly Progression. **Candidatos e bettors nunca são escolhidos à mão:** o Ready continua capturando e congelando sozinho o snapshot de bettors, o do Titan Roster com as roles e a configuração preparada (D-31, D-32, D-33, D-38).                                                                                |
| D-46 | —                   | **M0 #6 deixa de ser gate.** Não se espera o parse estabilizar: vale o do Auditar (D-43). #1 e #2 continuam gates, validados contra logs reais da Titan; divergência entre a leitura da API e a tela do WCL para a implementação do settlement automático baseado nela.                                                                                                                                                                                                                                                                                                                |

---

## 3. O pedido contra o CLAUDE.md

| Regra                           | O que ela impõe                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Fronteira Next ↔ Nest**   | Validação de slip, fase da rodada, odds, resolução e payout são do Nest. Nenhum route handler novo no Next.                                                                                                                                                                                                |
| **2 — Contrato no shared**      | Schemas em `packages/shared/src/titan-bet.ts`. Os limites 200/1.000 e o "inteiro" ficam no schema: form e pipe usam o mesmo.                                                                                                                                                                               |
| **3 — Módulo no Nest**          | Módulo `titan-bet` com controller/service/repository. Persiste, então tem repository.                                                                                                                                                                                                                      |
| **4 — Acesso**                  | D-01 põe o Titan Bet no **estado do meio**, como o M+: `RosterGuard`. É o segundo caso desse tipo, e segue o mesmo motivo ("o corte serve para manter a ferramenta do time de raid legível"). Ver §12, item 1, sobre a navegação.                                                                          |
| **4 — Permissões nomeadas**     | O `OfficerGuard` checa a precondição `isActingOfficer()`. Se confirmar depósito ou pagar ganhar regra diferente de "ser officer" (ex.: OQ-28), vira função própria no shared (`canConfirmBetSlip()`, `canSettleBets()`), no padrão de `canManageOfficers()` — nunca reusar uma permissão de outro assunto. |
| **5 — Autorização no Nest**     | Aceite de todo endpoint: sem cookie → 401; sem personagem no roster da guilda → 403; endpoint de officer chamado por membro → 403.                                                                                                                                                                         |
| **6 — APIs externas**           | WCL só pelo Nest. Identidade por **nome + realm**: `toCharacterKey()` no nome (mantém acento) e `toRealmMatchKey()` no realm (o WCL escreve `Area52`, o WoWAudit `Area 52`).                                                                                                                               |
| **7 — Derivar, humano corrige** | É literalmente D-08: o WCL propõe, o officer confirma, a correção é guardada (D-11).                                                                                                                                                                                                                       |
| **7 — Lacuna não é zero**       | Log que não chegou não vira "ninguém morreu" nem "0 dispels": o mercado fica sem resultado. Noite sem report oficial **não** vira `VOID` sozinha (D-24).                                                                                                                                                   |
| **7 — Durável guarda**          | D-07 remove o conflito que existia com o hard delete.                                                                                                                                                                                                                                                      |
| **8 — Ferramenta de operação**  | Reprocessamento de resultado vira rota em `internal/ops/*` com `OpsTokenGuard`. **Atenção:** ações de officer (confirmar, pagar, corrigir) **não** vão para ops — ops é ator de automação sem identidade, e D-11 exige officer responsável.                                                                |
| **Yaak**                        | Todo endpoint novo ganha request em `yaak/` no mesmo PR.                                                                                                                                                                                                                                                   |
| **Segredos**                    | Nenhum segredo novo. As credenciais do WCL já existem.                                                                                                                                                                                                                                                     |
| **Dado de membro**              | Fixtures de teste são logs **fictícios**. O M0 lê logs reais, mas o que ele deixa no repositório é a **forma** do dado, nunca nomes de membros.                                                                                                                                                            |

---

## 4. O que já existe e dá para reusar

| Peça existente                                     | Serve para                                                             | Observação                                                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RosterGuard`, `OfficerGuard`                      | D-01                                                                   | `req.user` (`SessionUser`) e `req.account` (conta com todos os `GuildCharacter`) já vêm prontos.                                                 |
| `SessionUser.characters`                           | lista para escolher o personagem depositante (D-02)                    | Limitação real em OQ-04a.                                                                                                                        |
| `WowAuditService.getTeamCharacters()`              | Titan Roster: nome, realm, classe, **role**                            | Cache de 1h. **Em falha devolve o cache velho sem sinalizar** (`fallback()`), diferente do roster da Blizzard, que tem `stale`. Ver §12, item 3. |
| `WarcraftLogsService`                              | token, id da guilda, listagem paginada, lote por alias, catálogo, 429  | Base do M0. O que falta está na §13.                                                                                                             |
| `toRaidPulls()`                                    | pull de boss de raid, sem trash e sem dungeon                          | Mythic = `difficulty === 5` na numeração do WCL.                                                                                                 |
| `getRaidParticipation()`                           | quem estava em cada pull (`friendlyPlayers` + `masterData.actors`)     | Hoje agrega por relatório e **descarta o índice da luta**; o Titan Bet precisa de participação **por luta**.                                     |
| `RaidNight` + `AttendanceService.dataLocal()`      | noite de raid oficial; casar log com noite pela data no fuso da guilda | Referência de fuso. Para o Titan Bet, a sessão é o **report** (D-26), não a data.                                                                |
| `RaidProgressService`                              | referência de "já morto em Mythic"                                     | Relatório com cache de 15 min. A classificação da aposta precisa ser **gravada**, não lida do cache (§7.1).                                      |
| `BlizzardService.getCurrentSeason()`               | `currentPeriod` = semana do jogo alinhada ao reset US                  | Chave da rodada (§5).                                                                                                                            |
| `Character` + `CharactersRepository.resolver*`     | identidade de personagem que nunca é apagada                           | Candidato, depositante e vencedor apontam para `Character` (D-03).                                                                               |
| `LootSessionEvent`                                 | trilha de auditoria                                                    | Ator sem FK (`actorUserId` + `actorBattletag`), `payload Json` versionado no shared, `clientEventId` idempotente.                                |
| `MplusService` `@Cron` de expurgo                  | job periódico                                                          | Os crons atuais **não** usam `timeZone`; o cutoff precisa.                                                                                       |
| Navegação do M+ (`acessoInterno` no `sidebar-nav`) | tela acessível a quem está fora do corte de rank                       | Precedente direto para D-01.                                                                                                                     |
| `OpsController` + `OpsTokenGuard`                  | reprocessar resultado                                                  | Regra 8.                                                                                                                                         |

---

## 5. Calendário, sessões e os três boundaries

Fuso: `GUILD_TIMEZONE` (hoje `America/Sao_Paulo`). Só raids **Mythic**.

```
 sex ─────────── (qualquer dia) ─────────── ter 12:00        ter        qui          depois
 │ PREPARATION: officers configuram │ READY │ OPEN: membros salvam e submetem │ CUTOFF │ raid ── raid ─┤ Auditar → settlement → closing report / payout
                                      ↑ configuration freeze                      ↑ fim das ações de aposta
                                              cada "Submeter pagamento" = slip freeze
```

### 5.1 A rodada é semanal (D-29)

A `BetRound` é a unidade de aposta e de settlement: a semana do reset, identificada pelo
**period da Blizzard**. Todos os mercados pertencem a ela. O cutoff de terça 12:00 BRT
coincide com o reset US (15:00 UTC) — coincidência útil, não premissa.

### 5.2 Sessões válidas: terça e quinta (D-19, D-23)

A rodada tem até **duas sessões de evidência**: a raid padrão de terça e a de quinta. Não
são containers de mercado — só fontes de reports para a auditoria. Raid de qualquer outro
dia não existe para o Titan Bet, com ou sem `titanbet` no título.

O report é o boundary da sessão (D-26): fight após a meia-noite no mesmo report oficial
continua sendo da terça (ou da quinta). Nunca dividir por `DATE(timestamp)`.

### 5.3 Três boundaries, três momentos

| Boundary                 | Gatilho                                    | Congela / encerra                                                                                                    | Escopo   |
| ------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------- |
| **Configuration freeze** | officer executa **Ready** (D-31)           | bettors, candidates e roles, encounters, farm/progressão, mercados, configuração da Weekly Progression; abre apostas | a rodada |
| **Slip freeze**          | membro clica **Submeter pagamento** (D-27) | o slip, suas Bets, escolhas, stakes, total e personagem depositante                                                  | um slip  |
| **Betting cutoff**       | terça 12:00 (D-35)                         | encerra criar, editar e submeter; `PENDING_DEPOSIT` → `EXPIRED`                                                      | a rodada |

Não se misturam: o cutoff não congela configuração (isso foi no Ready), e o Ready não
congela slip nenhum (antes dele não há slip).

### 5.4 Ready

- **Sem dia fixo.** Qualquer momento antes do cutoff, conforme a disponibilidade dos
  officers — sexta, fim de semana, segunda ou terça de manhã.
- **Atômico.** Primeiro lê as fontes externas (roster da guilda na Blizzard, Titan Roster
  no WoWAudit) e confere a qualidade: resposta **fresca**, não vazia. O M0 mostrou que o
  `WowAuditService` devolve cache velho em silêncio; o Ready precisa saber que não é esse
  o caso — o que exige o sinal `stale` já pedido na §12. Só então, numa transação:
  grava bettors e candidates, marca a rodada como pronta com officer e horário. Falhou
  qualquer coisa → nada gravado, rodada em `PREPARATION`, e a tentativa fica no
  `BetEvent`.
- **Validação da configuração** antes de congelar: boss de progressão só com First
  Death; Weekly Progression com ao menos um encounter marcado; nenhum mercado duplicado.

### 5.5 Cutoff é regra, não job

"Passou do cutoff" é avaliado **no request** (e no banco, §16.4). O job de terça 12:00
só materializa `PENDING_DEPOSIT` → `EXPIRED` (e `DRAFT` → `EXPIRED`, §16.5); se a
instância estiver fora às 12:00 (Regra 8), a regra continua valendo e o job idempotente
pega o atraso.

---

## 6. Entidades e estados

O desenho conceitual completo do M2 está na **§16**. Esta seção fica com a convenção de
nomes e a divisão de privacidade, que valem para ele.

### 6.1 Convenção de nomes — confrontada com o projeto

Os enums do projeto são **snake_case minúsculo**, e os domínios novos estão em
**português** (`LootSessionStatus`: `rascunho`, `aberta`, `deliberando`, `encerrada`).
Os nomes do produto são **rótulos conceituais**:

| Conceito (produto) | Enum sugerido         |
| ------------------ | --------------------- |
| `DRAFT` (slip)     | `rascunho`            |
| `PENDING_DEPOSIT`  | `aguardando_deposito` |
| `VALID`            | `valido`              |
| `REJECTED`         | `recusado`            |
| `EXPIRED`          | `expirado`            |
| `VOID`             | `anulado`             |
| `CALCULATED`       | `calculado`           |
| `CONFIRMED`        | `confirmado`          |
| `PAID`             | `pago`                |

A partir da revisão 5, o slip confirmado pelo officer chama-se `VALID` (antes
`CONFIRMED`), como no pedido de produto.

### 6.2 Dois lados do domínio

| Lado                     | O que é                                                                                                                    | Quem lê                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **private betting data** | slip (inclusive recusados), apostas, stake, escolhas, apostas perdedoras, valor depositado                                 | o dono (as próprias); sistema; officers conforme OQ-48 |
| **published results**    | resultado de cada mercado, vencedores, valor ganho por vencedor por mercado, `VOID`, total do Guild Bank, total por membro | todo membro (`RosterGuard`)                            |

Quem **aposta** e quem é **alvo** são populações diferentes (D-32, D-33): bettors são
contas elegíveis da guilda congeladas no Ready; candidates são personagens do Titan Roster
congelados no Ready, com role.

### 6.3 Tipos de mercado

Todos semanais (D-29), todos escolhidos pelo officer (D-20).

| Mercado              | Escolhas     | Candidatos (D-04)                      | Self-bet (D-09) | Resolve com                                                     |
| -------------------- | ------------ | -------------------------------------- | --------------- | --------------------------------------------------------------- |
| `TOP_DPS`            | exatamente 1 | `Melee` + `Ranged` do snapshot         | permitido       | a kill da semana                                                |
| `TOP_DPS_PARSE`      | exatamente 1 | `Melee` + `Ranged`                     | permitido       | a kill da semana                                                |
| `TOP_HPS`            | exatamente 1 | `Heal`                                 | permitido       | a kill da semana                                                |
| `TOP_HPS_PARSE`      | exatamente 1 | `Heal`                                 | permitido       | a kill da semana                                                |
| `TOP_DISPELS`        | exatamente 1 | todo o snapshot                        | permitido       | a kill da semana                                                |
| `FIRST_DEATH`        | exatamente 1 | todo o snapshot                        | **proibido**    | boss farm: a kill; boss em progressão: todas as pulls da semana |
| `WEEKLY_PROGRESSION` | 0..N         | encounters da rodada marcados para ela | —               | o conjunto de kills da semana                                   |

**Farm × progressão deixa de ser tipo de mercado e passa a ser do boss.** R-22 e R-24
definem: boss farm tem até seis mercados; boss em progressão, só First Death. Com D-20 é o
officer quem declara, por boss da rodada, se ele entra como farm ou progressão — e o
First Death segue o algoritmo correspondente. Um boss não tem mercados dos dois tipos na
mesma rodada (R-22 × R-24). Se o sistema valida essa declaração contra o histórico do WCL:
OQ-46.

Os candidatos vêm do snapshot do Ready (D-33); nenhuma aposta existe antes dele, então
não há aposta em candidato que "saiu" do Titan Roster.

---

## 7. Resolução

### 7.1 Quem decide farm e progressão

O officer, ao configurar a rodada (§6.3). O sistema não abre mercado de farm porque o boss
já morreu (D-20).

### 7.2 Auditar: fonte oficial e fluxo (D-18, D-24, D-25, D-26, D-30)

Uma fonte é válida se, e só se: (1) é a raid padrão de **terça ou quinta** do reset; (2)
é da **guilda Titan**; (3) o `title` começa com `titanbet`, sem diferenciar maiúsculas; (4)
é o report oficial daquela sessão — escolhido **automaticamente** quando inequívoco, ou
**pelo officer** quando ambíguo.

```
Officer clica Auditar
  → identifica a BetRound
  → procura reports titanbet* da guilda nas sessões de terça e quinta do reset
  → associa cada um à sua sessão
  → inequívoco? usa. ausente ou ambíguo? para e pede revisão do officer
  → congela a referência aos reports usados (code, title, revision)
  → lê as fights (Mythic + catálogo de raid)
  → calcula os resultados semanais
  → apresenta a auditoria calculada
  → officer revisa e confirma
  → settlement
```

- **Happy path:** um `titanbet*` por sessão, associação clara → usa sozinho. Registra
  reports, horário e officer que acionou.
- **Ausência (D-24):** nenhum `titanbet*` para uma sessão → a sessão fica **sem fonte**.
  Não é "sem raid", não é zero kills, não é `{}`, não é `VOID`, e nenhum report comum
  entra no lugar. Pede revisão do officer; o que o officer pode fazer é OQ-45.
- **Ambiguidade (D-25):** mais de um candidato para uma sessão → o sistema não escolhe;
  mostra os candidatos, o officer escolhe, e a escolha fica registrada com officer e
  horário.
- **Um** Auditar trabalha sobre a **rodada**. Não existem dois settlements, um para
  terça e outro para quinta.
- **Anomalia:** o mesmo boss com kill nas **duas** sessões, ou pulls repetidas dentro de
  um report, contrariam o lockout e o M0 — a auditoria não escolhe; pede revisão (mesma
  regra da ambiguidade; o tratamento é OQ-40/OQ-45).

Dentro do report: pull com `difficulty === 5` **e** encounter do catálogo de raid do WCL
(filtro do `toRaidPulls`); `difficulty` sozinho não basta (§15.4). Os encounters que o
officer vê ao configurar vêm do catálogo do WCL (D-22).

### 7.3 Algoritmos semanais

Comuns: só vence candidato do snapshot congelado (D-13); participação nunca altera
elegibilidade; empate → todos vencem (R-20); sem vencedor → proposta de `VOID`, válida só
com officer (D-06, D-16); só entram fights dos reports oficiais da rodada (§7.2).

- **Top DPS / Top HPS / Top Dispels / Parse %** (boss farm): a **kill** do boss na
  semana — terça, ou quinta se não morreu na terça. Maior valor entre os candidatos que
  participaram. Sem kill nos reports oficiais → proposta de `VOID`. Definições: OQ-25;
  off-spec: OQ-34.
- **First Death, boss farm:** na luta da kill, mortes de jogador em ordem de timestamp,
  pulando quem não está no snapshot (D-13); todas as mortes elegíveis na mesma timestamp
  da primeira elegível contam (D-14).
- **First Death, boss em progressão (D-29):** **todas** as pulls Mythic válidas do boss
  nos reports oficiais da **semana** (terça + quinta) → por pull, o mesmo percurso do farm
  → soma por personagem → maior soma vence; empate → vários. Nenhuma pull válida na
  semana → proposta de `VOID`. A lista de cada try, de qual sessão veio e seu First Death
  vão para a evidência (R-28a).
- **Weekly Progression:** `K` = encounters Mythic mortos nos reports oficiais da rodada.
  Aposta vence se e só se o conjunto escolhido **é igual** a `K`, inclusive `{}`. `K` só é
  afirmado quando **as duas sessões** estão resolvidas (fonte encontrada ou decisão do
  officer registrada); sessão sem fonte deixa `K` **indeterminado**, nunca `{}`. Kill de
  outro dia não conta. `K` ∩ encounters configurados: OQ-47.

### 7.4 Lacuna não é resultado

WCL fora do ar, report oficial ausente, relatório privado ou Titan Roster indisponível
**não** produzem resultado. O mercado fica sem resultado e a tela diz "aguardando log".
Report oficial ausente não é `VOID` automático nem `{}` (D-24): a noite fica sem fonte
até resolução administrativa (OQ-45).

### 7.5 Evidência congelada

O M0 confirmou os dois motivos para congelar: **Parse % muda** — até 16 pontos entre a
semana da kill e hoje (§15.6) — e o report **muda de revisão** enquanto recebe upload
(§15.3). O resultado confirmado é o que foi gravado, e a evidência mínima para auditar e
reproduzir está na §15.10.

---

## 8. Pool, arredondamento, payout e odds

### 8.1 Definições, por mercado

```
V  = Σ stake das apostas válidas do mercado            (pool válida)
P  = floor(9 × V / 10)                                   (prize pool, 90%)
G₀ = V − P                                               (10% da guilda, já com a fração)
W  = Σ stake das apostas válidas em QUALQUER opção vencedora
```

Mercado `VOID`: nada disso é calculado. Cada aposta válida vira `restituicao_anulado` do
valor integral. Receita da guilda = 0 (D-06).

### 8.2 Arredondamento (D-10)

Para cada aposta vencedora `i`, com aritmética **inteira**:

```
payout(i) = floor(P × stake(i) / W)
residuo   = P − Σ payout(i)
guilda    = G₀ + residuo = V − Σ payout(i)
```

Propriedades, todas verificáveis em teste:

- `Σ payout(i) ≤ P` sempre, porque cada termo é arredondado para baixo.
- `0 ≤ residuo < número de apostas vencedoras` (em gold).
- `Σ payout(i) + guilda = V` exatamente — nenhum gold criado ou perdido.
- **Não depende de ordem.** Não existe "o primeiro fica com a sobra", então não existe
  desempate escondido no arredondamento (coerente com R-20).
- Reprodutível: `V`, `P`, `W`, cada `stake(i)` e cada `payout(i)` ficam no
  `BetSettlement`. `P × stake(i)` fica abaixo de 10⁹ para qualquer pool realista, longe
  do limite de inteiro seguro do JavaScript.

Por que `floor` também no `P`: o 10% sobre um total que não é múltiplo de 10 dá fração,
e D-10 manda fração para o Guild Bank.

Exemplo: `V = 3.450`. `P = floor(31.050 / 10) = 3.105`, `G₀ = 345`. Vencedoras de 700 e
300 (`W = 1.000`): `floor(3.105 × 700 / 1.000) = 2.173`, `floor(3.105 × 300 / 1.000) =
931`. Soma 3.104, resíduo 1, guilda 346. Conferência: 3.104 + 346 = 3.450.

Consequência aritmética, não decisão: se quase toda a pool está na opção vencedora, quem
acerta recebe **menos do que apostou** (tudo numa opção só → cada um leva ~90%). A tela
precisa deixar isso visível.

### 8.3 Empate

Com `k` opções vencedoras, `W` soma as apostas de **todas** elas, e cada aposta vencedora
recebe `floor(P × stake(i) / W)`. Apostar numa opção que empatou rende o mesmo, por gold
apostado, que apostar em qualquer outra das empatadas.

### 8.4 Projected payout (R-33–R-35, D-12)

Enquanto o mercado está aberto, para cada opção `o`:

```
S(o)            = Σ stake das apostas válidas na opção o
projected(o)    = P / S(o) = floor(9V/10) / S(o)        ("—" se S(o) = 0)
```

O que o número **é**: quanto cada 1g apostado em `o` renderia **se o mercado fechasse
agora e `o` fosse a única vencedora**, antes do arredondamento para baixo.

O que ele **não é**, e a tela precisa dizer:

- **não é garantido** — muda a cada aposta válida nova, em qualquer opção;
- **empate reduz** — com mais opções vencedoras, o real é `P / W`, e `W > S(o)`;
- **arredondamento reduz** — o real é `floor`, até 1g a menos por aposta;
- **não é probabilidade** — reflete onde a guilda pôs gold, não a chance de acontecer;
- **só conta apostas válidas** — slip pendente não aparece (D-12). Consequência: o
  número de quem acabou de fechar um slip não muda até um officer confirmar.

Faixa: `0,9× ≤ projected(o)`. O piso é quando toda a pool está em `o`. Não há teto.

Weekly Progression: `o` é o conjunto exato. Com dezenas de combinações possíveis, a
maior parte terá `S(o) = 0` e mostrará "—".

Apostas individuais de outros membros **não** são visíveis: as apostas são secretas
(D-21). O que aparece é a soma por opção — ver §8.5.

### 8.5 Pagamento agregado e Round Closing Report (D-21)

**Pagamento.** O gold físico é pago **uma vez por membro por rodada**: um total operacional
("Total devido ao membro: 12.450g"). Por dentro, o total é a soma dos lançamentos do
ledger da conta do membro — prêmios, restituições e ajustes por mercado —, e é isso que
explica e audita o número. O pagamento é ele mesmo um lançamento, com officer, horário e
composição (§16.6).

O rateio da §8.2 continua **por aposta** (`floor` em cada uma). Agregar é somar linhas já
arredondadas, nunca recalcular sobre o total do membro — senão o `floor` mudaria de
lugar e o número deixaria de bater com o settlement de cada mercado.

**Round Closing Report.** Publicado depois do settlement, para os membros. Contém, por
rodada:

- mercados encerrados e o resultado vencedor de cada um;
- os vencedores e **quanto cada um ganhou naquele mercado**;
- mercados `VOID`, com o motivo;
- resumo do que foi para o Guild Bank, se a liderança quiser exibir;
- total agregado devido a cada membro.

**Não contém**, nunca: stake individual, opção escolhida antes do resultado, apostas
perdedoras, Bet Slips, histórico de apostas. Se algo é **inferível** — quem aparece como
vencedor de "Top DPS: personagem X" apostou em X; com `P` e o valor ganho dá para estimar
o stake —, isso não autoriza o sistema a **publicar** o dado. A regra é sobre o que o
sistema expõe, não sobre o que um leitor deduz.

Consequência aceita de R-34 + D-21: o projected payout (§8.4) expõe a **soma** apostada
por opção enquanto o mercado está aberto — é o que "refletir como a guilda aposta"
significa. Soma por opção não é dado de uma pessoa, mas numa opção com um único apostador
ela coincide com o stake dele. Registrado como risco (§10), não como pergunta: a decisão
de mostrar a distribuição já foi tomada.

---

### 8.6 Mercado sem aposta vencedora (`W = 0`) — D-44

O mercado tem resultado válido (`vencedores`), mas ninguém apostou numa opção vencedora.
Não é `VOID` e ninguém é restituído.

```
órfão o:      V(o), P(o) = floor(9V(o)/10), G₀(o) = V(o) − P(o)  → Guild Bank
premiáveis:   M = mercados da rodada com resultado `vencedores` e W > 0
por órfão:    cota = floor(P(o) / |M|), resto = P(o) − cota × |M|  → Guild Bank
receptor m:   P'(m) = P(m) + Σ cotas recebidas;  payout(i) = floor(P'(m) × stake(i) / W(m))
```

- Cada órfão reparte o **próprio** `P`: com dois órfãos, cada um divide o seu, e cada resto
  é arredondado à parte (o resto é "desse mercado", como diz a D-44).
- `VOID` não é premiável e não recebe; órfão também não.
- Órfão com `P = 0` (nenhuma aposta válida) não tem o que repartir.
- **Sem nenhum mercado premiável** para receber um `P > 0`: não há regra. O settlement
  **não liquida** a rodada e pede decisão — nenhum destino é inventado.
- Reconciliação muda de escopo: a de mercado (Σ `premio` + receita + resíduo = `V`) deixa de
  valer para órfão e receptor; vale a da **rodada** (§16.6).

---

## 9. Boundaries (PROPOSTA)

```
packages/shared/src/titan-bet/
  config.ts          rodada, encounters, mercados (officer) e o cardápio publicado
  betting.ts         PRIVATE: slip, aposta, escolhas — só para o dono e fluxos autorizados
  published.ts       PUBLISHED: resultados, closing report, projected payout
apps/api/src/titan-bet/
  titan-bet.module.ts
  titan-bet-member.controller.ts     RosterGuard + bettor do snapshot: cardápio, projected payout, Salvar, Submeter, o PRÓPRIO slip
  titan-bet-results.controller.ts    RosterGuard: closing report publicado
  titan-bet-officer.controller.ts    OfficerGuard (Officer Panel): configurar em PREPARATION, Ready, depósitos pendentes,
                                     confirmar/recusar, Auditar, resolver fonte, confirmar, pagar, restituir, ajustar, publicar
  titan-bet.service.ts               rodada, freezes, validação, self-bet
  titan-bet-audit.service.ts         Auditar: descoberta de titanbet*, fontes, cálculo semanal + evidência
  titan-bet-ledger.service.ts        settlement, ledger, saldo, pagamento
  titan-bet-closing.service.ts       closing report SÓ a partir de resultado + ledger
  titan-bet.repository.ts            único que toca Prisma
apps/api/src/warcraftlogs/           queries novas (title, revision, fight id, deaths, tables, rankings); nenhuma regra de aposta
apps/api/src/ops/                    reprocessamento técnico (Regra 8)
apps/web/app/interno/bet/            telas
yaak/                                uma request por endpoint novo
```

| Job               | Quando                      | Faz                                                                                                                |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `bet-cutoff`      | terça 12:00, fuso da guilda | materializa `aguardando_deposito`/`rascunho` → `expirado`. Idempotente. Não congela configuração (isso é o Ready). |
| `bet-abre-rodada` | sexta, fuso da guilda       | cria a rodada seguinte em `PREPARATION`, sem mercados; apostas só abrem no Ready de um officer (D-31)              |

**Não há job de coleta de resultados.** A auditoria é iniciada pelo officer (D-30), e
nenhum job escolhe report, confirma resultado ou `VOID`, ou marca pago.

### 9.1 O boundary da privacidade

A separação `private betting data` × `published results` **precisa de boundary
próprio**, mas não de módulo próprio. O motivo: o vazamento provável não é um endpoint
"mostrar apostas dos outros" — ninguém escreveria isso —, é um DTO de resultado que ganha
um campo `stake` num join conveniente, ou uma tela de resultado que reaproveita a query
do slip. É o mesmo desenho de falha que a Regra 2 evita para o contrato.

O que a spec propõe como boundary:

1. **Contrato separado no shared.** `published.ts` não importa nada de `betting.ts`. Um
   schema publicado que não tem campo de stake não consegue serializar stake — o
   typecheck quebra antes do vazamento, que é o que a Regra 2 pede.
2. **O closing report é uma projeção gravada.** Gerado a partir de settlement e ledger
   (que já têm só vencedor, mercado e valor), versionado e imutável, e é **isso** que o
   endpoint público lê — nunca uma query sobre `Bet`/`BetSlip` montada na hora.
3. **Endpoints de membro só leem o próprio slip.** O filtro por dono vive no repository,
   não no controller, para não depender de alguém lembrar.
4. **Officer não precisa da escolha para confirmar depósito.** Confirmar exige dono,
   personagem depositante e total — não as opções. Se a tela de confirmação mostra ou não
   as escolhas, e quais officers podem ver dado privado para settlement e auditoria,
   é OQ-48.

Mesmo precedente da Regra 7: o dado existe, e o que o sistema evita é apresentá-lo pronto
para quem não deveria recebê-lo.

---

## 10. Riscos

### Consistência

- **Confirmar × cutoff.** `UPDATE … SET status = confirmado WHERE status =
aguardando_deposito AND now() < cutoffAt`, e o job, `UPDATE … SET status = expirado
WHERE status = aguardando_deposito AND cutoffAt <= now()`. Quem chega primeiro vence; o
  outro não encontra a linha no estado de origem.
- **Dois officers no mesmo slip / no mesmo pagamento.** Mesmo `UPDATE` condicional; o
  segundo recebe "já feito por X às HH:MM".
- **Report oficial trocado depois do cálculo** (renomeado, reenviado, outra seleção):
  a seleção e a `revision` lidas ficam gravadas; mudança gera nova seleção e novo
  cálculo, nunca sobrescrita (§7.2, D-30).
- **Ready com fonte stale** congelaria candidatos ou bettors errados para a semana
  inteira: por isso o Ready é atômico e confere frescor antes de gravar (§5.4).
- **Freeze parcial**: bettors, candidates e configuração congelam **juntos** no Ready,
  numa transação. Congelar um e não o outro permitiria apostar num mercado que muda depois.
- **Titan Roster em cache velho** congelando opções erradas (§12, item 3).
- **Cache do `RaidProgressService`** não pode decidir nada do Titan Bet — ele também
  conta em dobro com dois loggers (§12).

### Settlement

- Parse que muda — resolvido congelando a evidência (§7.5).
- **Gates de produção** M0 #1 e #2 (§14): sem eles, settlement automático não liga (#6
  deixou de ser gate, D-46).
- Noite válida sem `titanbet*` na sexta — sem fonte, resolução administrativa (D-24,
  OQ-45); não é `VOID` nem `{}` automático.
- `PAID` imutável; correção só por `ajuste` (D-11).

### Auditoria

- Toda transição vira `BetEvent` com ator e horário: criar, confirmar, expirar,
  calcular, confirmar resultado, anular, restituir, pagar, ajustar.
- Nada é apagado: slip expira (D-07), resultado recalculado vira linha nova, correção
  vira obrigação nova.
- **Conferência do depósito é manual e cega**: nenhuma API expõe o Guild Bank. O log de
  dinheiro do banco no jogo é curto, e depósito antigo pode sair dele antes da
  conferência **[a confirmar no jogo]**.

### Integridade

- Self-bet em First Death proibido (D-09). A eficácia depende de OQ-27a.
- **Weekly Progression contra a própria guilda** continua possível: dá para apostar
  num conjunto que exclui um boss que a pessoa mesma ajuda a matar. Não é pergunta
  aberta — D-05 e D-09 não o proíbem —, é risco registrado.
- Officer confirmando o próprio slip — OQ-28.

### Privacidade

- **DTO de resultado ganhando campo privado** num join conveniente — o risco real;
  mitigado pelo boundary da §9.1.
- **Soma por opção no projected payout** coincide com o stake de quem apostou sozinho
  numa opção. Consequência aceita de R-34 + D-21 (§8.5).
- **Inferência a partir do closing report** (vencedor de "Top DPS: X" apostou em X) é
  inevitável e aceita; publicar o dado explicitamente, não.

---

## 11. Limites técnicos

| Pedido / implícito                          | Situação                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Confirmar depósito ou pagar automaticamente | **Impossível** — nenhuma API expõe o Guild Bank. Já é manual por R-12 e D-06.                          |
| Diferenciar "não pullou" de "não logou"     | **Impossível** — as duas são ausência de log. Ambas → `VOID`, então não bloqueia.                      |
| Ler log privado                             | **Impossível** com client credentials. Log privado = lacuna.                                           |
| Parse % estável                             | **Impossível** — o WCL recalcula. Contornado congelando a evidência.                                   |
| Saber todos os personagens de uma conta     | **Impossível** sem o token do usuário — é o limite conhecido do `GuildCharacter`. Ver OQ-04a e OQ-27a. |

---

## 12. Inconsistências entre as decisões e a arquitetura atual

1. **`RosterGuard` e a navegação.** O `RosterGuard` aceita rank 5+, mas a área
   `/interno` foi montada para o time de raid. O M+ já resolveu isso
   (`acessoInterno` no `sidebar-nav`); o Titan Bet precisa do mesmo tratamento, ou
   quem está fora do corte passa no Nest e não acha a tela. Não é bloqueio, é trabalho
   do M4.
2. **Quem aposta ≠ quem é candidato.** Com D-01 e D-04, um social de rank 7 aposta em
   personagens do time de raid, e o time de raid vê o próprio desempenho virar mercado
   para ~590 pessoas. Não contradiz nada escrito — a régua da Regra 7 é "isto vira
   comparação entre membros?", e o Titan Bet **é** comparação por construção, com dado
   que já está aberto no Logs. Registrado para a liderança saber que a decisão D-01 tem
   este efeito.
3. **O Titan Roster não tem histórico nem sinal de falha.** `getTeamCharacters()` só
   responde o **agora**, e em falha devolve o cache velho **sem avisar**. Congelar
   opções a partir disso pode congelar uma lista velha em silêncio. O Titan Bet precisa
   gravar o snapshot (`BetRosterSnapshot`) e saber se leu dado fresco — o que exige
   `stale` no `WowAuditService`, como o roster da Blizzard já tem. O congelamento é
   no **Ready** (D-31) — exatamente o instante em que uma leitura velha passaria calada; por
   isso o Ready confere frescor antes de gravar (§5.4).
4. **A role vem de uma fonte, a luta de outra.** Candidatura a Top DPS/HPS segue a role
   do WoWAudit (D-04). Um healer que joga de DPS numa kill não é candidato a Top DPS
   naquela kill, e um DPS que faz off-heal não é candidato a Top HPS. É consequência
   direta de D-04, não pergunta — e evita que o WCL defina candidato, que D-04 proíbe.
   O M0 corrigiu uma suposição anterior: o WCL entrega parse de **dps e de hps para
   todos** os participantes, cada um na spec que jogou (§15.6). Um candidato Healer que
   jogou de DPS **tem** HPS e HPS parse — da spec DPS. Se isso conta é OQ-34.
5. **Depositante e self-bet dependem do `GuildCharacter`**, que só ganha personagem
   novo no login. Com a sessão deslizante de 7 dias (TIT-148), isso pode demorar. Ver
   OQ-04a e OQ-27a.
6. **Nomes de estado.** Os rótulos do produto são inglês maiúsculo; o projeto usa
   snake_case em português. Resolvido como convenção no M2 (§6.1).
7. **Ações de officer não cabem em ops.** A Regra 8 manda operação para
   `internal/ops/*`, mas D-11 exige officer identificado; ops não tem identidade. Só o
   reprocessamento técnico vai para ops.
8. **O calendário do Titan Bet é mais estreito que o da guilda — de propósito.** O
   WoWAudit marca quartas e domingos como noite oficial Mythic (§15.3); o Titan Bet os
   ignora (D-19, D-23). Não é inconsistência a corrigir: quem ler o WoWAudit e estranhar
   a ausência de mercado numa quarta está vendo a regra funcionar.
9. **O contrato `titanbet*` ainda não é prática.** Nenhum report da guilda tem o
   prefixo, e os títulos hoje são livres. D-18 só funciona quando quem loga adotar o
   nome — é mudança de hábito, não de código (§15.13).
10. **Privacidade não existia no domínio.** Hoje nenhuma tela do site tem dado que um
    membro vê e outro não, fora a presença (Regra 7). O Titan Bet é o primeiro caso com
    **dado secreto entre membros** — daí o boundary da §9.1.

### Achados fora do Titan Bet

Findings separados, **não corrigidos neste trabalho** e que não devem ser misturados com o
Titan Bet:

| Serviço               | Achado                                                                                                                            | Evidência |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `RaidProgressService` | soma as pulls de todos os reports da janela; com dois loggers, pulls e kills da noite aparecem **em dobro** na tela de progressão | §15.8     |
| `AttendanceService`   | data a noite pelo **início do report**; o M0 achou report que começou no dia anterior às pulls que contém (não em noite oficial)  | §15.3     |

---

## 13. OPEN QUESTIONS

### Resolvidas

| Revisão | OQ → decisão                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2       | OQ-01 (D-01) · OQ-04 parcial (D-02) · OQ-10 (D-03) · OQ-11 (D-04) · OQ-14 e OQ-15 (D-06) · OQ-17 (D-05) · OQ-19 (D-08) · OQ-20 (D-07) · OQ-21 (D-12) · OQ-23 (D-10) · OQ-24 (D-11) · OQ-27 (D-09) |
| 3       | OQ-13 (D-13) · OQ-16 (D-14) · OQ-17a (D-15) · OQ-31 (D-16) · OQ-32 (D-17)                                                                                                                         |
| 4       | OQ-08 (D-19) · OQ-09 (D-20) · OQ-26 (D-21) · OQ-35 (D-22) · OQ-36 (D-23) · OQ-37 (D-24) · OQ-38 (D-25) · OQ-41 (D-26)                                                                             |
| 5       | OQ-05 (D-27) · OQ-29 (D-28) · OQ-44 (D-29) · OQ-42 (D-30)                                                                                                                                         |
| 7       | OQ-53 (D-38)                                                                                                                                                                                      |
| 6       | OQ-06 (D-34) · OQ-02 (D-35) · OQ-49, OQ-33 e a parte de configuração da OQ-43 (D-31)                                                                                                              |

Fechadas por consequência (mantidas): OQ-12 (D-19/D-23), OQ-22 (D-21), OQ-07 (D-20 →
OQ-46), OQ-18 (→ OQ-45 e OQ-25).

### Abertas

**Nenhuma muda uma constraint da primeira migration.** A coluna "1ª migration" diz o que
a resposta faria com o schema, se fizer algo.

| OQ         | Pergunta                                                                                                                                                                                                                                                                     | 1ª migration                                                          | Até    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| **OQ-56**  | **Nova.** Acesso à superfície de apostas: (a) quem está no snapshot de bettors mas **saiu da guilda** depois do Ready — o `RosterGuard` o barra do site, embora a elegibilidade da rodada continue (D-32); (b) membro do site **fora** do snapshot pode ver mercados e odds? | Não: autorização.                                                     | M6     |
| **OQ-54**  | **Nova.** Slip **recusado** com depósito real (valor errado, personagem errado): gera restituição, como o expirado (D-07)?                                                                                                                                                   | Não: um valor a mais no enum de `kind` do ledger — migration aditiva. | M5     |
| **OQ-55**  | **Nova.** Projected payout da Weekly Progression: listar os conjuntos com aposta expõe, anonimamente, seleções privadas. Mostrar só para o conjunto que o membro está montando? Não mostrar?                                                                                 | Não: consulta e contrato.                                             | M6     |
| **OQ-48**  | Quais officers veem **escolhas privadas**, para quê? (Depósito já não precisa delas — §16.9.)                                                                                                                                                                                | Não: autorização e DTO.                                               | M5     |
| **OQ-28**  | Officer pode confirmar o próprio slip?                                                                                                                                                                                                                                       | Não.                                                                  | M5     |
| **OQ-04a** | Personagem de guilda da pessoa ainda não ligado à conta não aparece para depositar. Aceita-se?                                                                                                                                                                               | Não.                                                                  | M4     |
| **OQ-27a** | "Próprio personagem" no self-bet: o depositante, qualquer personagem ligado à conta, outro?                                                                                                                                                                                  | Não: validação no service.                                            | M4     |
| **OQ-46**  | O sistema valida o `track` (farm/progressão) declarado pelo officer contra o histórico do WCL?                                                                                                                                                                               | Não.                                                                  | M3     |
| **OQ-45**  | Fluxo de sessão **sem fonte** (D-24), raid cancelada e anomalias da §7.2: o que o officer pode fazer, há prazo?                                                                                                                                                              | Não: valores a mais em `resolution`/`voidReason` — aditivo.           | M7     |
| **OQ-50**  | Liquidação **parcial** da rodada?                                                                                                                                                                                                                                            | Não na 1ª: confirmação por resultado seria coluna nova — aditivo.     | M7     |
| **OQ-25**  | Métricas de farm além do parse: DPS/HPS sobre a duração da luta ou tempo ativo, cura com absorb, dispels com purge em inimigo. **Parse % resolvido na D-43.** Seja qual for, o valor usado fica congelado na evidência e nunca é recalculado.                                | Não: evidência.                                                       | M7     |
| **OQ-34**  | Candidato fora da role do snapshot: HPS/HPS parse da spec DPS contam?                                                                                                                                                                                                        | Não.                                                                  | M7     |
| **OQ-39**  | Report `titanbet*` parcial.                                                                                                                                                                                                                                                  | Não.                                                                  | M7     |
| **OQ-40**  | Pull repetida dentro do report, ou o mesmo boss morto nas duas sessões.                                                                                                                                                                                                      | Não.                                                                  | M8     |
| **OQ-47**  | `K` = kills ∩ encounters configurados para a Weekly?                                                                                                                                                                                                                         | Não: algoritmo.                                                       | M8     |
| **OQ-03**  | Quem perde membership com slip `VALID` continua concorrendo e recebe?                                                                                                                                                                                                        | Não.                                                                  | M9     |
| **OQ-51**  | Identidade do vencedor no Closing Report.                                                                                                                                                                                                                                    | Não: conteúdo do documento.                                           | M9     |
| **OQ-52**  | Saldo negativo depois de ajuste.                                                                                                                                                                                                                                             | Não: `ajuste` já tem sinal.                                           | M9     |
| **OQ-30**  | Avisos no Discord?                                                                                                                                                                                                                                                           | Não.                                                                  | pós-M9 |

**Gates, não OQs:** M0 #1 e #2 bloqueiam **ligar settlement automático em produção**,
não o schema (§14). O #6 deixou de ser gate (D-46).

---

## 14. Milestones

Cada milestone é um PR com CI verde e as requests do Yaak junto.

### M0 — Capacidade real do Warcraft Logs (EXECUTADO em 23/09/2026)

**Objetivo:** saber, antes de modelar, se o WCL entrega de forma confiável tudo que os
mercados precisam. **Fora do escopo:** descobrir lineup ou candidatos — o Titan Roster é
a fonte (D-04, D-13), e o WCL só é lido depois, para o resultado.

**Boundary respeitado:** consultas GraphQL avulsas, rodadas de scripts descartáveis
**fora do repositório**, com a credencial de client do `.env` local. Nada em `apps/`,
nenhum model, migration, endpoint, job ou tela. Nenhum nome de membro, código de report
ou credencial neste documento.

Resultado completo na **§15**. Critérios:

| #   | Critério                                                                          | Status                | Por quê                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | As seis métricas de farm, lidas pela API, batem com a **tela** do WCL             | **BLOCKED**           | A interface do WCL respondeu com **verificação humana** ao navegador automatizado, e o M0 não contorna controle de acesso. O que foi verificado: consistência entre endpoints independentes da API e entre dois reports da mesma kill (§15.5). |
| 2   | Tries de progressão com o First Death de cada uma reproduzidas e iguais à tela    | **BLOCKED**           | Reprodução pela API: **feita** (§15.7). Comparação com a tela: mesmo bloqueio do item 1.                                                                                                                                                       |
| 3   | Deduplicação entre dois reports produz a mesma lista de tries; tolerância anotada | **PASS**              | 123 pares em 7 noites, 100% casados; First Death elegível idêntico em 108 de 108 tries duplicadas (§15.8).                                                                                                                                     |
| 4   | Todo participante casa com o Titan Roster ou é listado como fora dele             | **PASS**              | 20 de 20 nas kills da amostra; outsiders contados, nenhum descarte silencioso (§15.7).                                                                                                                                                         |
| 5   | Resolução da timestamp de morte e mortes simultâneas anotadas                     | **PASS**              | Milissegundo; empates existem (§15.7).                                                                                                                                                                                                         |
| 6   | Atraso entre o fim da raid e o parse disponível anotado                           | **BLOCKED**           | Não é mensurável olhando o passado. Só um limite superior: a kill da noite anterior já tinha parse na manhã seguinte. Medir exige acompanhar uma raid ao vivo.                                                                                 |
| 7   | Custo em pontos por noite anotado                                                 | **PASS**              | §15.11                                                                                                                                                                                                                                         |
| 8   | Spec atualizada, marcações trocadas por fato, OQs com dado                        | **PASS**              | §13 e §15                                                                                                                                                                                                                                      |
| 9   | Descoberta do report oficial `titanbet*` (D-18)                                   | **PASS com ressalva** | A API lista reports da guilda por janela de tempo e devolve `title`; o prefixo é aplicável. **Nenhum report da guilda tem o prefixo hoje**, então a regra foi testada só sobre títulos reais que não casam (§15.3).                            |
| 10  | Weekly Progression, inclusive `{}`                                                | **PASS com ressalva** | O conjunto exato sai dos reports, e `{}` aconteceu em 8 de 21 resets. Ausência de report não prova `{}` (§15.9).                                                                                                                               |

**Gates de produção.** Os itens 1, 2 e 6 **não bloqueiam** o M1 nem o desenho do M2, e
**bloqueiam habilitar settlement automático em produção**. Nenhum resultado foi
inventado para fechá-los:

- **#1** — comparação humana das seis métricas de farm com a tela do WCL;
- **#2** — comparação humana do First Death das tries com a tela do WCL;
- ~~**#6**~~ — **deixou de ser gate (D-46):** vale o parse disponível no Auditar.

**Para destravar sem contornar nada:** uma pessoa abre no navegador as lutas da
amostra e confere contra os valores que os scripts do probe regeram (guardados fora do
repositório, sem dados); e alguém anota o horário em que o parse aparece na próxima raid.

### M1 — Decisões restantes

**Status:** concluído na revisão 7 para o que o schema precisa (OQ-53 resolvida pela
D-38). Gates M0 #1, #2 e #6 com responsável antes de ligar
settlement automático.

### M2 — Contrato e schema

**Etapa 1 (concluída):** desenho final na §16. **Etapa 2:** shared + models Prisma +
migration com as constraints, índices parciais, CHECKs e triggers da §16.4. Sem endpoint.

**Aceite da etapa 2:** `pnpm build && pnpm typecheck` verdes; migration aplica em banco
limpo; **cada** constraint, índice parcial, CHECK e trigger da §16.4 tem um teste que
tenta violá-lo e falha; schema do shared: 199 recusado, 200 e 1.000 aceitos, 1.001 e
200,5 recusados; `published` não importa nada de `betting`.

### M3 — Rodada, Ready e relógio

**Aceite:** rodada nasce em `PREPARATION`; officer configura, remove e altera; membro →
403 em configuração; Ready com fonte stale ou vazia falha e nada é gravado; Ready feliz
grava bettors, candidates e `readyAt` juntos; depois do Ready, qualquer escrita de
configuração ou snapshot falha **no banco**; Ready depois do cutoff é recusado; fases da
§16.5 corretas com relógio fixo (terça 11:59:59 e 12:00:00 nos lados certos); job de cutoff
idempotente.

### M4 — Slip do membro (Salvar × Submeter pagamento)

**Aceite:** sem cookie → 401; conta fora do snapshot de bettors → 403, mesmo sendo da
guilda hoje; rank 5+ no snapshot passa; Salvar cria o slip e depois reusa o mesmo; Salvar
adiciona, remove e altera; alvo fora do snapshot de candidates, ou na role errada para o
tipo, é recusado no banco; segunda Bet no mesmo mercado → recusada; Weekly com 0, 1 e N
bosses → aceita; Submeter congela e muda para `aguardando_deposito`; escrita depois disso
→ recusada no banco; segundo slip ativo → recusado no banco; stake fora de 200–1.000 ou
não inteiro → recusado; self-bet em First Death → 400; nada disso depende do front.

### M5 — Depósito: confirmar e recusar

**Aceite:** membro → 403; DTO do officer sem escolhas; confirmar → `valido` +
`deposito_validado` na mesma transação; recusar → `recusado` com motivo, terminal; depois
da recusa, antes do cutoff, o membro cria **novo** slip em `rascunho` e o recusado fica
intacto; depois do cutoff, não; confirm × cutoff e confirm × confirm concorrentes seguros.

### M6 — Superfície de apostas e projected payout

**Aceite:** membro elegível vê mercados, candidatos e projected payout de todos os mercados
publicados; o contrato de odds não tem userId, slip nem stake; só apostas `valido` contam;
opção sem aposta mostra "—"; membro nunca obtém a aposta de outro por nenhuma rota; rota
de officer chamada por membro → 403.

### M7 — Auditar e resultado de farm

**Aceite (logs fictícios):** Auditar trabalha sobre a rodada; um `titanbet*` por sessão →
usado sem seleção manual, com reports, horário e officer registrados; zero ou vários →
auditoria para em revisão, nada calculado; report de outro dia ignorado mesmo com
`titanbet`; report de terça/quinta sem o prefixo ignorado; fight após 00:00 no mesmo report
conta para a sessão; fight de dungeon com `difficulty 5` não entra; kill na terça ou na
quinta resolve o mesmo mercado; vencedor certo por métrica; empate → N; outsider nunca
vence; parse ausente ≠ 0; sem kill → proposta de `VOID`, válida só com officer; refazer a
auditoria cria outra tentativa e mantém a anterior. **Gates M0 #1, #2 e #6 fechados antes
de ligar em produção.**

### M8 — First Death de progressão e Weekly Progression

**Aceite:** pulls de terça **e** quinta somadas (terça A 3 / B 2, quinta A 1 / B 3 → B
vence com 5); outsider morto primeiro é pulado; mortes elegíveis na mesma timestamp
contam todas; empate na soma → vários vencedores; evidência guarda cada try, a sessão e o
First Death; Weekly: conjunto igual vence, um boss a mais ou a menos perde, `{}` vence só
sem kill nos reports oficiais; sessão sem fonte deixa `K` indeterminado, nunca `{}`; kill
fora de terça/quinta não entra.

### M9 — Settlement, ledger, pagamento e Round Closing Report

**Aceite:** o exemplo da §8.2 reproduzido; as três reconciliações da §16.6 passam para
qualquer entrada gerada; mercado `VOID` gera `restituicao_anulado` integral e receita 0;
nenhum valor financeiro existe fora do ledger; saldo do membro = soma da conta dele;
pagar insere `pagamento` com officer, horário e composição; dois pagamentos concorrentes →
o segundo encontra saldo zero; nenhum lançamento é alterado ou apagado; correção cria
`ajuste` com motivo e referência; o closing report é gerado sem ler `Bet`,
`BetWeeklySelection` ou stake, e o schema publicado não tem campo para eles; republicar gera
nova versão.

---

## 15. Resultado do M0 — Warcraft Logs capability probe (23/09/2026)

> Registro do que o M0 encontrou, como estava na revisão 3. As OQs citadas aqui foram
> em parte resolvidas depois (revisão 4, §2 e §13); a §13 é a lista vigente.

### 15.1 Amostra

Tudo público no WCL, lido pela API v2 com client credentials. Nomes, códigos de report e
donos ficaram fora deste documento; os personagens aparecem só como contagens.

| Conjunto                          | O que é                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Índice de reports                 | 169 reports da guilda em 240 dias (mar–set/2026), com `title`, tempos, visibilidade, revisão e zona.                               |
| Fights                            | todas as fights de encounter dos reports de raid: 1.142 fights Mythic.                                                             |
| **Noite F** (set/2026, oficial)   | duas kills de boss **farm** do tier atual + tries de um boss em progressão, registradas em **dois reports** de loggers diferentes. |
| **Noites P** (jun–set/2026)       | 8 noites Mythic de progressão — 280 fights lidas, ≈172 tries distintas depois de deduplicar. 2 noites com um report, 6 com dois.   |
| **Kills antigas** (mai, jun, set) | 4 kills para medir deriva de parse.                                                                                                |
| **Resets** (abr–set/2026)         | 21 resets com pull Mythic de raid, para Weekly Progression.                                                                        |
| Titan Roster                      | lido do WoWAudit no dia do probe: 26 personagens, roles `Tank`, `Melee`, `Heal`, `Ranged`.                                         |

**Nenhum dos reports segue o contrato `titanbet*`** — nenhum report da guilda tem o
prefixo. Eles serviram só como **fixture investigativa**, e isso **não** abre exceção à
D-18: nenhum report sem o prefixo é fonte válida de settlement.

**Viés conhecido:** o Titan Roster usado é o **de hoje**, aplicado a noites de junho e
julho. Isso infla "outsiders" nas noites antigas (gente que saiu do time) e é a
demonstração empírica de por que D-17 congela a lista por rodada.

### 15.2 Queries testadas

| Capacidade               | Query                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| listar reports da guilda | `reportData.reports(guildID, startTime, endTime, limit, page)` → `code title startTime endTime visibility revision segments exportedSegments zone owner archiveStatus` |
| fights                   | `report.fights(killType: Encounters)` → `id encounterID name difficulty kill fightPercentage startTime endTime gameZone friendlyPlayers wipeCalledTime`                |
| mortes                   | `report.events(dataType: Deaths, fightIDs)` e `report.table(dataType: Deaths, fightIDs)`                                                                               |
| dano / cura / dispels    | `report.table(dataType: DamageDone / Healing / Dispels, fightIDs)`; `events(dataType: Dispels)`                                                                        |
| parse                    | `report.rankings(fightIDs, playerMetric: dps / hps, timeframe: Historical / Today, compare: Rankings / Parses)`                                                        |
| spec real na luta        | `report.playerDetails(fightIDs)`                                                                                                                                       |
| catálogo de raid         | `worldData.expansions.zones` (a mesma do `getRaidCatalog()`)                                                                                                           |

O `WarcraftLogsService` **não** foi importado: rodá-lo exige subir o Nest, e a Regra 8
existe por causa disso. As queries dele foram reproduzidas à mão, e as lacunas estão na
coluna "serviço atual" da §15.12.

### 15.3 Report oficial, datas e fuso

- **Listar por guilda e janela de tempo:** funciona, paginado. Um report por `code`,
  estável.
- **`title`:** vem em todo report. Títulos reais são texto livre — piadas internas,
  nomes de pessoas, vazio em 2 de 169. `/^titanbet/i` é aplicável sem ambiguidade.
- **Nenhum `titanbet*` existe hoje.** Ausência (OQ-37) e multiplicidade (OQ-38) são
  detectáveis: basta contar os reports com o prefixo cujas pulls caem na noite.
- **Visibilidade:** 169 de 169 públicos, nenhum arquivado (`archiveStatus`). Report
  privado seria ilegível — `BLOCKED_BY_AUTH_OR_VISIBILITY` por construção, não observado.
- **O título é editável pelo dono** e nada no report registra quando mudou. A API expõe
  `owner`, o que permitiria restringir quem publica o report oficial — OQ-42.
- **`revision`** muda enquanto o report recebe upload. Nos reports de setembro,
  `revision` ≈ `segments`: a guilda loga **ao vivo**. Guardar a revisão lida é o que diz
  se o report mudou desde a apuração.
- **`startTime`/`endTime` do report não delimitam a raid.** Reports começam até 2h
  antes da primeira pull, e **28 de 169 terminam depois da meia-noite** local porque o
  logger ficou aberto — em noites oficiais, a última pull foi sempre antes das 23:35.
  Pulls **depois** da meia-noite só apareceram em noites não oficiais (até 02:02), e um
  report de outra dificuldade **começou no dia anterior** às pulls que contém. A noite
  deve ser resolvida pela **data local das pulls**; qual noite vale para pull após a
  meia-noite é OQ-41.
- **Fuso:** `GUILD_TIMEZONE` aplicado às pulls data corretamente todas as noites
  oficiais contra o calendário do WoWAudit.
- **Noites oficiais além de terça e quinta:** desde abril o WoWAudit marcou **4 quartas e
  1 domingo** como noite oficial Mythic, mais 2 noites opcionais — OQ-36.
- **Report parcial** não é detectável olhando o próprio report. As referências externas
  que existem: horário planejado no WoWAudit (`start_time`/`end_time`) e outro report da
  mesma noite — OQ-39.
- **Dois reports na mesma noite nem sempre são duplicatas.** Em 2 das 9 noites com mais
  de um report, os reports tinham pulls **diferentes** (18×18 com 1 coincidência; 21×14
  com 2) — outro grupo, ou logs parciais. Esse é o caso que D-18 resolve: sem o prefixo,
  não há como saber qual é "o" report da noite.

### 15.4 Encounter, dificuldade, kill

- **Encounter:** `encounterID` estável e o mesmo nos dois reports.
- **`difficulty === 5` não basta.** 69 fights com `difficulty 5` em reports da guilda
  eram **boss de dungeon**. O filtro de catálogo de raid do `toRaidPulls` é obrigatório.
- **Tier ≠ raid (OQ-35).** O tier anterior era **uma zona do WCL com três raids**, e havia
  uma zona separada, de **um boss**, morto em noite oficial. O tier atual aparece em
  **duas zonas** do WCL (10 e 9 encounters), além de zonas "Complete Raid" com
  encounters próprios. "Os bosses da raid atual" não sai de uma zona só.
- **Kill/wipe:** `kill` e `fightPercentage` idênticos entre reports duplicados em 100%
  dos pares.
- **`wipeCalledTime`:** nulo em 1.142 de 1.142 fights. Não serve para nada.

### 15.5 Métricas de farm (Noite F, 2 kills × 2 reports)

| Métrica     | O que o WCL entrega                                                                                                                                               | Verificação                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Damage      | `table(DamageDone).entries[].total`, com pets somados ao dono                                                                                                     | **Idêntico** nos dois reports, 20 de 20 jogadores, nas duas kills.                                                                                                    |
| DPS         | **não vem pronto** na tabela; é `total ÷ duração da luta` (`endTime − startTime`), **não** tempo ativo                                                            | `rankings.amount` = `total ÷ duração` **exato** para os 14 DPS. Entre reports, a duração difere ~40 ms → o DPS difere na 5ª casa, e a ordem **não** mudou.            |
| Healing     | `table(Healing).entries[].total`                                                                                                                                  | Igual ao `rankings(hps).amount × duração` para os 4 healers. Se inclui absorb não foi verificado (precisa da tela — item 1).                                          |
| HPS         | `total ÷ duração`                                                                                                                                                 | idem                                                                                                                                                                  |
| Dispels     | `table(Dispels)` agrupa por **debuff removido**, com o total de cada jogador em `details[]`. `events(Dispels)` dá um evento por dispel, com `sourceID` e `isBuff` | Tabela e eventos somam o mesmo (16 numa kill, 0 na outra). Todos com `isBuff: false` (debuff tirado de aliado). **Purge em inimigo não apareceu** na amostra — OQ-25. |
| First Death | `events(Deaths)`: `timestamp` em ms, relativo ao início do report, `targetID` → ator                                                                              | Tabela e eventos concordam (1 e 11 mortes). Igual nos dois reports.                                                                                                   |

Recomendação técnica: calcular dispels **pelos eventos**, não pela tabela — a tabela
reaproveita campos de interrupt (`spellsInterrupted`) que confundem a leitura.

### 15.6 Parse %

- **Fonte:** `report.rankings(fightIDs, playerMetric: dps | hps)`. Devolve `rankPercent`
  (geral) e `bracketPercent` (faixa de ilvl), por jogador, com `spec`, `partition`,
  `bracket` e `amount`.
- **Entrega parse de dps e de hps para os 20**, inclusive tanks e healers no `dps` e DPS
  no `hps`. Cada um é comparado dentro da própria spec.
- **Depende do report:** a mesma kill em dois reports deu parse diferente em 1 de 20
  jogadores (36 × 37). Consequência direta do report oficial: o parse é o do `titanbet*`.
- **Deriva com o tempo:**

  | Idade da kill | Jogadores DPS com `Today ≠ Historical` | Faixa    |
  | ------------- | -------------------------------------- | -------- |
  | 1 dia         | 1 de 20                                | 1 ponto  |
  | 13 dias       | 9 de 14                                | −11 a −5 |
  | 3 meses       | 13 de 14                               | −15 a +8 |
  | 4 meses       | 13 de 14                               | −16 a +1 |

- **`compare: Parses` ≠ `compare: Rankings`** em 11–13 de 14 jogadores da mesma kill.
- Se `Historical` fica **congelado** depois de alguns dias não é verificável num probe
  único: exige consultar a mesma kill em dias diferentes.
- **Qual número a tela do WCL mostra como "Parse %"** não foi verificado (item 1).

Conclusão técnica: o valor **pode** ser capturado e congelado no momento do cálculo, e
**precisa** ser — reconsultar depois dá outro número. Qual das quatro combinações
(comparação × timeframe) e em que momento capturar é OQ-25.

### 15.7 First Death, participação e identidade

- **Mortes por fight:** `events(dataType: Deaths, fightIDs)`, só jogadores (nenhuma
  morte de pet ou NPC apareceu entre 5.254 mortes). Uma query devolve todas as mortes de
  todas as fights de um report sem paginar.
- **Precisão:** milissegundo. **Relativa ao início do report** — a mesma morte tem
  timestamps diferentes em dois reports. Comparar entre reports exige
  `report.startTime + timestamp`.
- **Empates existem:** em 280 fights lidas, 2 tiveram duas mortes na mesma ms, e 1 teve o
  empate **entre elegíveis**. D-14 não é caso teórico.
- **Pular outsiders (D-13) é necessário e funciona:** nas noites de setembro, a
  **primeira morte absoluta** foi de alguém **fora** do Titan Roster em 1–4 tries por
  noite. Das 280 fights, só 2 não tiveram morte nenhuma; nas outras 278 sempre houve
  uma morte elegível depois dos outsiders.
- **Participação por fight:** `fights.friendlyPlayers` (ids de ator) + `masterData.actors`.
  O serviço atual lê isso mas agrega por report e perde o `fightId`.
- **Identidade:** `actor.name` + `actor.server` casaram com o Titan Roster por
  `toCharacterKey` + `toRealmMatchKey` em **20 de 20** participantes das duas kills.
- **Off-spec (OQ-34):** `playerDetails` mostrou um personagem registrado como `Heal` no
  Titan Roster jogando **spec DPS** nas duas kills. O WCL o classifica como DPS na luta, e
  ele ficou entre os três maiores DPS. Por D-04 ele não é candidato a Top DPS; a
  elegibilidade dele não muda (D-13). O que a métrica de HPS dele significa é OQ-34.
- **Reprodução de progressão:** `try → First Death elegível` e `personagem → contagem`
  reproduzidos para as 8 noites P a partir de `code`, `fightId`, `report.startTime`,
  eventos de morte e Titan Roster.

### 15.8 Duplicação

| Medida (7 noites com reports duplicados, 123 pares)         | Valor             |
| ----------------------------------------------------------- | ----------------- |
| pares casados por `encounterID` + início absoluto           | 123 de 123        |
| diferença de início entre as duas cópias                    | 0,3 s a **3,7 s** |
| diferença de fim                                            | até 3,9 s         |
| `kill` e `fightPercentage` iguais                           | 100%              |
| First Death elegível igual                                  | 108 de 108 tries  |
| menor intervalo entre duas pulls consecutivas do mesmo boss | **46 s**          |
| pulls sobrepostas **dentro** de um mesmo report             | 0                 |

A margem entre 3,7 s e 46 s é larga: `encounterID` igual + início absoluto a menos de
~10 s separa duplicata de pull seguinte **em toda a amostra**. Isso é evidência, não
heurística aprovada — aplicar automaticamente é OQ-40. Duplicata dentro de um report não
foi observada.

Achado **fora do Titan Bet**: `RaidProgressService` soma as pulls de todos os reports, e
com dois loggers as pulls e kills da noite **aparecem em dobro** na tela de progressão
(ex.: "2 kills" de um boss numa semana com lockout). Registrado aqui, não corrigido.

### 15.9 Weekly Progression

- O conjunto exato de encounters Mythic mortos por reset sai das fights, com o filtro de
  catálogo e o reset US (terça 15:00 UTC).
- **`{}` é comum:** 8 dos 21 resets com pull Mythic terminaram sem kill — lockout
  estendido em progressão.
- **Ausência de report não é `{}`:** um reset com noite oficial Mythic marcada no
  WoWAudit não teve **nenhuma** pull em report nenhum. Pelos dados não dá para dizer se a
  raid foi cancelada ou não foi logada. `{}` só pode ser afirmado quando **toda** noite
  oficial do reset tem report apurado.
- **Kills fora de noite oficial existem:** num reset, duas kills Mythic num sábado e num
  domingo sem noite oficial (OQ-12). Pela D-18 elas não têm `titanbet*` e não entram.
- **Mortes repetidas no reset** só apareceram por duplicação de report; nas noites
  oficiais, cada boss morreu no máximo uma vez por reset.

### 15.10 Evidência mínima para auditoria

O que é **necessário** para responder "qual report, qual fight, qual encounter, quando,
com quais dados, e dá para reproduzir":

| Item                                                                                                                         | Necessário? | Por quê                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| `report.code`                                                                                                                | **sim**     | identificador estável; é por ele que se reconsulta                           |
| `report.title` como lido                                                                                                     | **sim**     | prova de que o report casava com `titanbet*` no momento; o título é editável |
| `report.revision` como lida                                                                                                  | **sim**     | diz se o report mudou depois da apuração                                     |
| `report.startTime`                                                                                                           | **sim**     | converte timestamps relativos em absolutos                                   |
| `report.endTime`, `owner`                                                                                                    | não         | `endTime` não delimita a raid; `owner` só se OQ-42 exigir                    |
| `fight.id`, `encounterID`, `difficulty`, `kill`                                                                              | **sim**     | identificam a luta e provam que é a kill Mythic                              |
| `fight.startTime`/`endTime`                                                                                                  | **sim**     | a duração é o denominador de DPS/HPS; o início absoluto é o que deduplica    |
| `fightPercentage`                                                                                                            | útil        | segunda confirmação de que duas cópias são a mesma pull                      |
| por candidato: `name` + `server` como vieram, e o `Character` resolvido                                                      | **sim**     | auditar o casamento de identidade                                            |
| valor bruto (`total`) **e** o valor usado (DPS/HPS/contagem)                                                                 | **sim**     | o total é reproduzível; a taxa depende da duração                            |
| parse: `rankPercent`, `bracketPercent`, `spec`, `metric`, `timeframe`, `compare`, `partition`, `bracket`                     | **sim**     | o valor **não** é reproduzível depois; o que foi lido é a única prova        |
| First Death: por try, as mortes em ordem **até** a primeira elegível (outsiders pulados, empates na mesma ms), com timestamp | **sim**     | R-28a e D-13/D-14                                                            |
| pares deduplicados e a regra usada                                                                                           | **sim**     | quando houver deduplicação                                                   |
| snapshot do Titan Roster congelado (referência)                                                                              | **sim**     | elegibilidade é do cutoff, não de hoje                                       |
| `computedAt` e versão do algoritmo                                                                                           | **sim**     | o mesmo report pode dar outro resultado com outro algoritmo                  |
| talentos, gear, eventos completos, token                                                                                     | **não**     | nenhum resultado depende disso; token nunca                                  |

**Reprodutível depois:** dano, cura, dispels, mortes, kill e duração — enquanto a
`revision` não mudar. **Não reprodutível:** parse.

### 15.11 Custo

O probe inteiro gastou ~440 pontos, menos de 1/8 do limite de 3.600/hora. As métricas das
duas kills farm com três variantes de rankings, nos dois reports, custaram ~54 pontos
(~13 por kill por report). As mortes de 280 fights em 13 reports, ~150 pontos. Cota não
é restrição para o Titan Bet.

### 15.12 Matriz de capabilities

`AVAILABLE_AND_VERIFIED` · `AVAILABLE_WITH_CAVEATS` · `NOT_AVAILABLE` ·
`REQUIRES_DIFFERENT_WCL_QUERY` · `BLOCKED_BY_AUTH_OR_VISIBILITY`. A coluna "serviço atual"
diz se o `WarcraftLogsService` de hoje já busca o dado.

| Capacidade                   | Classificação                   | Serviço atual                  | Ressalva                                                                         |
| ---------------------------- | ------------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| descoberta do report oficial | `AVAILABLE_WITH_CAVEATS`        | lista, mas sem `title`         | nenhum `titanbet*` real ainda; título editável (OQ-42); 0/N/parcial são OQ-37–39 |
| report title                 | `AVAILABLE_AND_VERIFIED`        | `REQUIRES_DIFFERENT_WCL_QUERY` | —                                                                                |
| report ID                    | `AVAILABLE_AND_VERIFIED`        | sim (`code`)                   | somar `revision`                                                                 |
| report timestamps            | `AVAILABLE_WITH_CAVEATS`        | só `startTime`                 | não delimitam a raid (§15.3)                                                     |
| encounter                    | `AVAILABLE_WITH_CAVEATS`        | sim                            | tier ≠ raid (OQ-35)                                                              |
| Mythic difficulty            | `AVAILABLE_WITH_CAVEATS`        | sim                            | exige o filtro de catálogo: 69 fights de dungeon com `difficulty 5`              |
| kill/wipe                    | `AVAILABLE_AND_VERIFIED`        | sim                            | —                                                                                |
| fight ID                     | `AVAILABLE_AND_VERIFIED`        | `REQUIRES_DIFFERENT_WCL_QUERY` | `RaidPull` não tem `id` nem `endTime`                                            |
| participantes                | `AVAILABLE_AND_VERIFIED`        | `REQUIRES_DIFFERENT_WCL_QUERY` | hoje agregado por report                                                         |
| identidade personagem/realm  | `AVAILABLE_AND_VERIFIED`        | sim                            | 20/20 com as funções da Regra 6                                                  |
| deaths                       | `AVAILABLE_AND_VERIFIED`        | `REQUIRES_DIFFERENT_WCL_QUERY` | timestamp relativo ao report                                                     |
| First Death                  | `AVAILABLE_WITH_CAVEATS`        | `REQUIRES_DIFFERENT_WCL_QUERY` | não comparado com a tela (bloqueio)                                              |
| damage                       | `AVAILABLE_WITH_CAVEATS`        | `REQUIRES_DIFFERENT_WCL_QUERY` | não comparado com a tela                                                         |
| DPS                          | `AVAILABLE_WITH_CAVEATS`        | `REQUIRES_DIFFERENT_WCL_QUERY` | calculado (total ÷ duração); definição em OQ-25                                  |
| DPS Parse %                  | `AVAILABLE_WITH_CAVEATS`        | `REQUIRES_DIFFERENT_WCL_QUERY` | deriva até 16 pontos; 4 variantes; muda entre reports                            |
| healing                      | `AVAILABLE_WITH_CAVEATS`        | `REQUIRES_DIFFERENT_WCL_QUERY` | absorb não verificado                                                            |
| HPS                          | `AVAILABLE_WITH_CAVEATS`        | `REQUIRES_DIFFERENT_WCL_QUERY` | idem                                                                             |
| HPS Parse %                  | `AVAILABLE_WITH_CAVEATS`        | `REQUIRES_DIFFERENT_WCL_QUERY` | idem DPS Parse; existe também para quem joga DPS (OQ-34)                         |
| dispels                      | `AVAILABLE_WITH_CAVEATS`        | `REQUIRES_DIFFERENT_WCL_QUERY` | purge não observado (OQ-25)                                                      |
| Weekly Progression kills     | `AVAILABLE_WITH_CAVEATS`        | parcial (`getRaidPulls`)       | `{}` só com todas as noites apuradas; OQ-35/36/37                                |
| deduplicação                 | `AVAILABLE_WITH_CAVEATS`        | `NOT_AVAILABLE`                | regra observada, não aprovada (OQ-40)                                            |
| evidência reprodutível       | `AVAILABLE_WITH_CAVEATS`        | —                              | tudo menos parse, enquanto a `revision` não mudar                                |
| comparação com a tela do WCL | `BLOCKED_BY_AUTH_OR_VISIBILITY` | —                              | verificação humana no site                                                       |
| report privado               | `BLOCKED_BY_AUTH_OR_VISIBILITY` | —                              | nenhum observado; seria ilegível                                                 |

### 15.13 O que muda para o produto

Nada do que foi decidido ficou tecnicamente impossível. Três descobertas pedem decisão:

1. **Parse % não é um número, são quatro, e todos derivam.** Sem fixar comparação,
   timeframe e momento de captura (OQ-25), dois officers calculando em dias diferentes
   chegam a vencedores diferentes.
2. **O "report da noite" não existia até a D-18.** Dois reports por noite são a regra, e
   às vezes não são duplicatas. A D-18 resolve a escolha, mas ninguém da guilda nomeia
   report com `titanbet` hoje: o contrato só vale quando virar hábito de quem loga.
3. **Lockout estendido é frequente** (8 de 21 resets). Mercados de farm abertos para boss
   que não vai ser pullado viram `VOID` em série; é o dado que faltava para a OQ-09.

### 15.14 Evidência suficiente para avançar?

**Sim para o M1 e para desenhar o M2**, com duas pendências que não bloqueiam o schema:

- os itens 1, 2 e 6 do M0 dependem de uma pessoa (conferir a tela; anotar o parse numa
  raid ao vivo). Precisam estar feitos **antes do M7**, que é quem calcula resultado;
- as OQs marcadas "antes do M2" na §13 mudam a forma do dado gravado.

---

## 16. Desenho do schema do M2 — revisão final (ainda não é Prisma)

> Revisão 6. Nomes de entidade em inglês para conversar com o produto; enums em
> snake_case português (§6.1). Nada foi escrito em `schema.prisma`; nenhuma migration
> existe.

### 16.1 Entidades finais (16)

```
BetRound                      1 por reset; PREPARATION até o Ready
 ├─ BetRoundEncounter         bosses da rodada (farm | progressão, entra na Weekly?)
 ├─ BetMarket                 mercados semanais
 ├─ BetRoundBettor            snapshot: quem pode apostar            ┐ congelados
 ├─ BetRoundCandidate         snapshot: quem pode ser alvo + role     ┘ no Ready
 ├─ BetSlip                   ≤ 1 ativo por bettor; recusados ficam   ┐
 │   └─ Bet                   ≤ 1 por mercado                         │ PRIVADO
 │       └─ BetWeeklySelection  0..N bosses (só Weekly)               ┘
 ├─ BetAudit                  cada Auditar; ≤ 1 confirmada
 │   ├─ BetAuditSource        terça | quinta: qual report, como escolhido
 │   └─ BetMarketResult       por mercado: vencedores ou VOID, evidência e V/P/W
 │       ├─ BetMarketResultWinner   personagens vencedores
 │       └─ BetMarketResultKill     K da Weekly (0..N)
 ├─ GoldLedgerEntry           ÚNICA fonte financeira; append-only
 ├─ RoundClosingReport        documento publicado, versionado
 └─ BetEvent                  só o que nenhuma estrutura imutável já registra
```

**Mudanças em relação à revisão 5:**

| Mudança                                                           | Por quê                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BetRosterEntry` → **`BetRoundBettor`** + **`BetRoundCandidate`** | Eram duas populações numa tabela ambígua (D-32, D-33). Bettor é **conta** (quem aposta, ~centenas); candidate é **personagem** do Titan Roster com role (~26). Chaves, fontes e perguntas diferentes.                                                             |
| `BetMarketSettlement` **absorvida** por `BetMarketResult`         | Era 1:0..1 com o resultado e guardava só `V`, `P`, `W`. A auditoria só roda **depois do cutoff**, quando todo slip já é terminal ou `valido`: `V` calculado na auditoria é o mesmo da confirmação. Uma tabela a menos, e um lugar a menos para o número divergir. |
| `BetEvent` **encolhido**                                          | Cada ação relevante já tem ator e horário numa estrutura imutável (§16.8). O `BetEvent` fica com o que se perderia: mudanças de configuração em `PREPARATION` (inclusive remoções) e tentativas de Ready que falharam.                                            |
| Estado da `BetRound` **quase todo derivado**                      | Só o Ready precisa ser gravado (§16.5).                                                                                                                                                                                                                           |
| `BetSlip` ganha **`recusado`**; unicidade vira **parcial**        | D-34.                                                                                                                                                                                                                                                             |

Continuam fora, pelos motivos da revisão 5: `BetRaidNight` como container (terça/quinta
são fatos da auditoria — `BetAuditSource`), `BetMarketOption` (candidato de um mercado =
`BetRoundCandidate` filtrado pela role do tipo; materializar criaria cópia divergente),
`MemberPayout` (pagamento é lançamento do ledger).

### 16.2 Campos

Convenções: gold é `Int` inteiro; instantes em UTC; ator = `…UserId` + `…Battletag`
**sem FK** (precedente `LootSession`: registro não some com a conta). `Character` é a
identidade existente, nunca apagada.

#### Configuração (mutável só em `PREPARATION`)

**`BetRound`**

| Campo                                               | Nota                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| `period`                                            | **único**                                                         |
| `seasonId`                                          | informativo                                                       |
| `opensAt`, `cutoffAt`                               | calculados na criação no fuso da guilda; imutáveis                |
| `readyAt`, `readyByUserId`, `readyByBattletag`      | o configuration freeze. **Nulo = `PREPARATION`**. Escrito uma vez |
| `bettorSourceFetchedAt`, `candidateSourceFetchedAt` | de quando é o dado externo congelado — prova de frescor do Ready  |
| `createdAt`                                         |                                                                   |

**`BetRoundEncounter`** — `roundId`, `encounterId` (catálogo WCL, D-22), `encounterName`,
`zoneName` (como lidos na configuração), `track` (`farm` \| `progressao`),
`inWeeklyProgression`, `createdBy*`, `updatedBy*`, datas.

**`BetMarket`** — `roundId`, `kind` (7 tipos, §6.3), `roundEncounterId` (nulo só na
Weekly), `track` (copiado do encounter pela FK composta, nulo na Weekly), `createdBy*`,
datas. **Sem status**: existe = publicado (§16.5).

#### Snapshots (escritos só dentro da transação do Ready; nunca alterados)

**`BetRoundBettor`** — "este personagem da guilda estava elegível para apostar nesta
rodada?" (D-38)

| Campo                    | Nota                                                       |
| ------------------------ | ---------------------------------------------------------- |
| `roundId`, `characterId` | par **único**; `characterId` → `Character`                 |
| `rank`                   | rank do personagem no Ready — a evidência da elegibilidade |
| `name`, `realm`          | como a Blizzard escrevia no Ready                          |

Fonte: leitura **fresca** do roster da Blizzard no Ready — todos os personagens da guilda
(a população do `RosterGuard`, D-01), resolvidos para `Character` sem depender de login.
Nenhuma conta é exigida. Uma pessoa com vários personagens na guilda tem várias linhas;
continua com **um** slip ativo, porque o slip é da conta.

**`BetRoundCandidate`** — "este personagem era candidato, e com que role?"

| Campo                    | Nota                                             |
| ------------------------ | ------------------------------------------------ |
| `roundId`, `characterId` | par **único**                                    |
| `role`                   | `Tank` \| `Melee` \| `Heal` \| `Ranged` no Ready |
| `name`, `realm`          | como o WoWAudit escrevia no Ready                |

Único também em `(roundId, characterId, role)` — é o alvo da FK composta da `Bet`.

#### Private betting data

**`BetSlip`**

| Campo                                                                      | Nota                                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `roundId`, `ownerUserId`, `ownerBattletag`                                 | a conta dona (sem FK)                                                                                                                                                                                        |
| `eligibilityCharacterId`                                                   | FK composta `(roundId, eligibilityCharacterId)` → `BetRoundBettor`: o personagem da conta que deu a elegibilidade. Que ele é **da conta** (`GuildCharacter`) é regra de aplicação, conferida ao criar o slip |
| `status`                                                                   | §16.5                                                                                                                                                                                                        |
| `depositCharacterId`                                                       | → `Character`; nulo em `rascunho`                                                                                                                                                                            |
| `expectedTotal`                                                            | nulo em `rascunho`; congelado no submit                                                                                                                                                                      |
| `submittedAt`                                                              | slip freeze                                                                                                                                                                                                  |
| `validatedByUserId`, `validatedByBattletag`, `validatedAt`                 | R-15                                                                                                                                                                                                         |
| `rejectedByUserId`, `rejectedByBattletag`, `rejectedAt`, `rejectionReason` | D-34                                                                                                                                                                                                         |
| `expiredAt`                                                                |                                                                                                                                                                                                              |
| `createdAt`, `updatedAt`                                                   |                                                                                                                                                                                                              |

**`Bet`**

| Campo                             | Nota                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `slipId`, `roundId`               | FK composta → `BetSlip(id, roundId)`                                                              |
| `marketId`, `marketKind`          | FK composta → `BetMarket(id, roundId, kind)`                                                      |
| `stake`                           | um por Bet; 200–1.000                                                                             |
| `targetCharacterId`, `targetRole` | FK composta `(roundId, targetCharacterId, targetRole)` → `BetRoundCandidate`; **nulos na Weekly** |
| `createdAt`, `updatedAt`          |                                                                                                   |

**`BetWeeklySelection`** — `betId`, `roundId`, `marketKind` (fixo `weekly_progression`),
`roundEncounterId`, `inWeeklyProgression` (fixo `true`). PK `(betId, roundEncounterId)`.
Zero linhas = aposta em `{}`.

#### Auditoria e resultado (imutáveis depois da confirmação)

**`BetAudit`** — `roundId`, `attempt`, `status`, `startedBy*`, `startedAt`,
`calculatedAt`, `confirmedBy*`, `confirmedAt`, `supersededByAuditId`.

**`BetAuditSource`** — `auditId`, `session` (`terca` \| `quinta`), `resolution`
(`automatica` \| `escolha_officer` \| `ausente` \| `ambigua`, + o que a OQ-45 trouxer),
`reportCode`, `reportTitle`, `reportRevision`, `reportStartTime`, `candidates` (JSON de
**evidência**: os `titanbet*` achados), `resolvedBy*`, `resolvedAt`.

**`BetMarketResult`** — `auditId`, `marketId`, `roundId`, `outcome` (`vencedores` \|
`anulado`), `voidReason`, `validPool` (`V`), `prizePool` (`P`, nulo se anulado),
`winningStake` (`W`, nulo se anulado), `evidence` (documento versionado no shared, §15.10),
`algorithmVersion`, `computedAt`.

**`BetMarketResultWinner`** — `(resultId, characterId)`. **`BetMarketResultKill`** —
`(resultId, roundEncounterId)`; zero linhas com `outcome = vencedores` = `K = {}`.

#### Dinheiro e publicação

**`GoldLedgerEntry`** e **`RoundClosingReport`** — §16.6 e §16.7. **`BetEvent`** — §16.8.

### 16.3 Relações e cardinalidades

| Relação                                         | Card.    | Garantia                                                                            |
| ----------------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| reset → `BetRound`                              | 1 : 0..1 | `period` único                                                                      |
| `BetRound` → `BetRoundEncounter`                | 1 : N    | `(roundId, encounterId)` único                                                      |
| `BetRound` → `BetMarket`                        | 1 : N    | §16.4                                                                               |
| `BetRoundEncounter` → `BetMarket`               | 1 : 0..6 | `(roundId, kind, roundEncounterId)` único                                           |
| `BetRound` → `BetRoundBettor`                   | 1 : N    | `(roundId, characterId)` único                                                      |
| `BetRound` → `BetRoundCandidate`                | 1 : N    | `(roundId, characterId)` único                                                      |
| `BetRoundBettor` → `BetSlip`                    | 1 : N    | pelo personagem de elegibilidade; ≤ 1 slip **ativo** por **conta** (índice parcial) |
| `BetSlip` → `Bet`                               | 1 : 0..N | `(slipId, marketId)` único                                                          |
| `Bet` → `BetRoundCandidate`                     | N : 0..1 | FK composta com role                                                                |
| `Bet` (Weekly) → `BetWeeklySelection`           | 1 : 0..N | PK `(betId, roundEncounterId)`                                                      |
| `BetRound` → `BetAudit`                         | 1 : N    | `(roundId, attempt)` único; ≤ 1 `confirmada` (índice parcial)                       |
| `BetAudit` → `BetAuditSource`                   | 1 : 0..2 | `(auditId, session)` único; `session` só tem dois valores                           |
| `BetAudit` → `BetMarketResult`                  | 1 : N    | `(auditId, marketId)` único                                                         |
| `BetSlip` → `GoldLedgerEntry` (conta do membro) | 1 : N    | §16.6                                                                               |
| `BetRound` → `RoundClosingReport`               | 1 : N    | `(roundId, version)` único                                                          |

### 16.4 Constraints, índices e triggers

**Unique e FK (Prisma):**

| Tabela                           | Constraint                                                                                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BetRound`                       | `period` único                                                                                                                                                                                                 |
| `BetRoundEncounter`              | `(roundId, encounterId)` único; `(id, roundId, inWeeklyProgression)` e `(id, roundId, track)` únicos (alvos de FK)                                                                                             |
| `BetMarket`                      | `(roundId, kind, roundEncounterId)` único; `(id, roundId, kind)` único (alvo); FK `(roundEncounterId, roundId, track)` → encounter — o `roundId` entrou no GREEN-M2B para cumprir o §16.3 (nada cruza rodadas) |
| `BetRoundBettor`                 | `(roundId, characterId)` único                                                                                                                                                                                 |
| `BetRoundCandidate`              | `(roundId, characterId)` único; `(roundId, characterId, role)` único (alvo)                                                                                                                                    |
| `BetSlip`                        | `(id, roundId)` único (alvo); FK `(roundId, eligibilityCharacterId)` → `BetRoundBettor`                                                                                                                        |
| `Bet`                            | `(slipId, marketId)` único; `(id, roundId, marketKind)` único (alvo); FKs compostas para slip, mercado e candidate                                                                                             |
| `BetWeeklySelection`             | PK `(betId, roundEncounterId)`; FKs compostas `(betId, roundId, marketKind)` → `Bet`, `(roundEncounterId, roundId, inWeeklyProgression)` → encounter                                                           |
| `BetAudit`                       | `(roundId, attempt)` único                                                                                                                                                                                     |
| `BetAuditSource`                 | `(auditId, session)` único                                                                                                                                                                                     |
| `BetMarketResult`                | `(auditId, marketId)` único                                                                                                                                                                                    |
| `BetMarketResultWinner` / `Kill` | `(resultId, characterId)` / `(resultId, roundEncounterId)` únicos                                                                                                                                              |
| `RoundClosingReport`             | `(roundId, version)` único                                                                                                                                                                                     |

**Índices únicos parciais (SQL na migration — precedente `WowDataBuild_um_ativo_so`):**

| Índice                                                                                       | Garante                                                                    |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `BetSlip (roundId, ownerUserId) WHERE status IN ('rascunho','aguardando_deposito','valido')` | ≤ 1 slip **ativo** por membro por rodada; recusados e expirados não contam |
| `BetMarket (roundId) WHERE kind = 'weekly_progression'`                                      | uma Weekly por rodada (`NULL` não colide no unique composto)               |
| `BetAudit (roundId) WHERE status = 'confirmada'`                                             | uma auditoria confirmada por rodada                                        |
| `GoldLedgerEntry (betId) WHERE kind IN ('premio','restituicao_anulado')`                     | um lançamento de resultado por aposta                                      |
| `GoldLedgerEntry (slipId) WHERE kind = 'deposito_validado'`                                  | um depósito por slip                                                       |
| `GoldLedgerEntry (resultId, kind) WHERE kind IN ('receita_guilda','residuo_guilda')`         | uma receita e um resíduo por mercado                                       |

**CHECK (aprovados na D-37; só regras locais à linha):**

| Tabela               | CHECK                                                                                                                                                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BetRound`           | `readyAt IS NULL OR readyAt < cutoffAt`; `readyAt` e `readyByUserId` nulos juntos                                                                                                                                                                                                        |
| `BetMarket`          | `(kind = 'weekly_progression') = (roundEncounterId IS NULL)`; `track = 'progressao' ⇒ kind = 'first_death'`; `(roundEncounterId IS NULL) = (track IS NULL)` — sem o último, a FK composta (MATCH SIMPLE) não confere mercado com `track` nulo                                            |
| `BetSlip`            | `status ∈ (aguardando_deposito, valido, recusado) ⇒ submittedAt, expectedTotal, depositCharacterId NOT NULL`; `valido ⇒ validated* NOT NULL`; `recusado ⇒ rejected* NOT NULL`; `expirado ⇒ expiredAt NOT NULL`; `expectedTotal > 0`                                                      |
| `Bet`                | `stake BETWEEN 200 AND 1000`; `(marketKind = 'weekly_progression') = (targetCharacterId IS NULL)`; `targetCharacterId IS NULL = targetRole IS NULL`; `marketKind ∈ (top_dps, top_dps_parse) ⇒ targetRole ∈ (Melee, Ranged)`; `marketKind ∈ (top_hps, top_hps_parse) ⇒ targetRole = Heal` |
| `BetWeeklySelection` | `marketKind = 'weekly_progression'`; `inWeeklyProgression = true`                                                                                                                                                                                                                        |
| `BetAuditSource`     | `resolution ∈ (automatica, escolha_officer) ⇔ reportCode NOT NULL`; referência (`reportCode`, `reportTitle`, `reportRevision`, `reportStartTime`) inteira ou nula; `escolha_officer ⇒ resolvedBy* NOT NULL` (implementado com `⇔` e a referência inteira em 23/09/2026)                  |
| `BetMarketResult`    | `outcome = 'anulado' ⇔ voidReason NOT NULL`; `outcome = 'anulado' ⇒ prizePool, winningStake IS NULL`; `validPool ≥ 0`                                                                                                                                                                    |
| `GoldLedgerEntry`    | `amount > 0` exceto `ajuste` (`≠ 0`); `ajuste ⇒ correctsEntryId, reason, actor NOT NULL`; `account = 'membro' ⇔ slipId NOT NULL`; `pagamento ⇒ actor, coversThroughEntryId NOT NULL`                                                                                                     |

**Triggers (regras multi-linha que o CHECK não alcança):**

| Trigger                       | Tabelas                                             | Regra                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `titanbet_rodada_imutavel`    | `BetRound` (UPDATE)                                 | `period`, `opensAt` e `cutoffAt` nunca mudam; `readyAt` e o officer do Ready são escritos uma vez — sem isso, zerar o `readyAt` reabriria a configuração (acrescentado no M2C, T-R18) |
| `titanbet_config_congelada`   | `BetRoundEncounter`, `BetMarket`                    | INSERT/UPDATE/DELETE só se a rodada tem `readyAt IS NULL`                                                                                                                             |
| `titanbet_snapshot_imutavel`  | `BetRoundBettor`, `BetRoundCandidate`               | INSERT só com `readyAt IS NULL` (a transação do Ready grava antes de marcar `readyAt`); UPDATE/DELETE nunca                                                                           |
| `titanbet_slip_aberto`        | `BetSlip` (INSERT)                                  | só com `readyAt IS NOT NULL` e `now() < cutoffAt`                                                                                                                                     |
| `titanbet_slip_transicao`     | `BetSlip` (UPDATE)                                  | só as transições da §16.5; colunas de submit/validação/recusa/expiração escritas uma vez; submit, validação e recusa só antes do cutoff                                               |
| `titanbet_aposta_editavel`    | `Bet`, `BetWeeklySelection`                         | qualquer escrita só se o slip está `rascunho` e `now() < cutoffAt`                                                                                                                    |
| `titanbet_resultado_imutavel` | `BetAuditSource`, `BetMarketResult*`, `BetAudit`    | depois de `BetAudit.status = confirmada` — ou `substituida`, também terminal (T-A09) —, nada muda; `BetMarketResult*` nunca sofre UPDATE/DELETE                                       |
| `titanbet_append_only`        | `GoldLedgerEntry`, `RoundClosingReport`, `BetEvent` | UPDATE e DELETE rejeitados (`BEFORE UPDATE OR DELETE … RAISE EXCEPTION`); `BEFORE TRUNCATE` também                                                                                    |

Trigger é prática **nova** no projeto (hoje só há índice parcial em SQL). É o mecanismo
que faz "imutável depois do Ready" e "append-only" valerem **por construção**, como a
D-31 e a D-37 pedem, sem depender de cada service lembrar.

### 16.5 Estados

**`BetRound`** — só o Ready é gravado; o resto é derivado de dados que já existem.

| Fase                         | Derivada de                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `PREPARATION`                | `readyAt IS NULL` e `now() < cutoffAt`                                                 |
| `NAO_ABERTA` (terminal)      | `readyAt IS NULL` e `now() ≥ cutoffAt` — ninguém deu Ready                             |
| `OPEN`                       | `readyAt` preenchido e `now() < cutoffAt`                                              |
| `BETTING_CLOSED` (auditável) | `now() ≥ cutoffAt`, sem auditoria em andamento                                         |
| `AUDITING` / `CALCULATED`    | a última `BetAudit` não substituída está `aguardando_revisao` / `pronta` / `calculada` |
| `SETTLED`                    | existe `BetAudit` `confirmada` (o settlement é gravado na mesma transação)             |
| `CLOSED`                     | existe `RoundClosingReport` publicado                                                  |

```
PREPARATION ──Ready──▶ OPEN ──cutoff──▶ BETTING_CLOSED ──Auditar──▶ AUDITING ──▶ CALCULATED ──confirmar──▶ SETTLED ──publicar──▶ CLOSED
PREPARATION ──cutoff sem Ready──▶ NAO_ABERTA
```

Gravar essas fases como coluna criaria uma segunda verdade que o job teria de manter
sincronizada. A função de fase vive no service e é testável com relógio fixo.

**`BetSlip`**

```
rascunho ──Submeter pagamento──▶ aguardando_deposito ──officer confirma──▶ valido
                                        │
                                        ├──officer recusa──▶ recusado   (terminal)
                                        └──cutoff──────────▶ expirado   (terminal)
rascunho ──cutoff──▶ expirado (terminal; submittedAt nulo = nunca houve depósito esperado)
```

| Estado                | Ativo? | Editável?            | Entra em pool? |
| --------------------- | ------ | -------------------- | -------------- |
| `rascunho`            | sim    | sim, antes do cutoff | não            |
| `aguardando_deposito` | sim    | não                  | não            |
| `valido`              | sim    | não                  | **sim**        |
| `recusado`            | não    | não                  | não            |
| `expirado`            | não    | não                  | não            |

**Ativos** = `rascunho`, `aguardando_deposito`, `valido`. `valido` é final mas **ativo**:
impede criar outro slip na rodada. Não há mais estados: cancelar um rascunho é esvaziá-lo
(nenhuma decisão pediu estado de cancelamento), e o slip vazio expira no cutoff.

**`BetMarket`** não tem estado (§16.1): antes do Ready pode ser apagado; depois, não muda.
O desfecho vive no resultado da auditoria confirmada.

**`BetAudit`**: `aguardando_revisao` ⇄ `pronta` → `calculada` → `confirmada`; qualquer
não confirmada → `substituida` quando uma nova tentativa começa.

### 16.6 A única fonte financeira: `GoldLedgerEntry`

**Autoridade.** Todo gold que o site afirma — depositado, devido, da guilda, pago — é uma
linha do ledger, e nenhuma outra tabela guarda esses valores:

| Estrutura               | Papel                 | Por que não compete com o ledger                                     |
| ----------------------- | --------------------- | -------------------------------------------------------------------- |
| `BetMarketResult.V/P/W` | entrada do cálculo    | explica como os lançamentos foram calculados; não é valor de ninguém |
| `BetSlip.expectedTotal` | instrução operacional | o que depositar; vira fato no ledger como `deposito_validado`        |
| saldo devido ao membro  | projeção              | Σ da conta do slip                                                   |
| pagamento               | lançamento            | uma linha `pagamento`                                                |
| `RoundClosingReport`    | documento publicado   | gerado do ledger, com marca d'água                                   |

| Campo                                        | Nota                                                |
| -------------------------------------------- | --------------------------------------------------- |
| `id`                                         | sequencial — ordem total                            |
| `roundId`, `account`                         | `membro` \| `guild_bank`                            |
| `slipId`                                     | conta do membro na rodada (obrigatório em `membro`) |
| `kind`, `amount`                             | tabela abaixo                                       |
| `marketId`, `betId`, `resultId`              | origem                                              |
| `correctsEntryId`, `reason`                  | `ajuste`                                            |
| `coversThroughEntryId`                       | `pagamento`: até onde quita (a composição)          |
| `actorUserId`, `actorBattletag`, `createdAt` |                                                     |

| `kind`                 | Conta      | Quando                                             |
| ---------------------- | ---------- | -------------------------------------------------- |
| `deposito_validado`    | membro     | slip → `valido`, na mesma transação                |
| `premio`               | membro     | confirmação da auditoria; uma por aposta vencedora |
| `restituicao_anulado`  | membro     | `VOID` confirmado; uma por aposta válida           |
| `receita_guilda`       | guild_bank | confirmação; `G₀` por mercado                      |
| `residuo_guilda`       | guild_bank | confirmação; resíduo do `floor`                    |
| `restituicao_expirado` | membro     | officer, com motivo (D-07)                         |
| `ajuste`               | qualquer   | officer, com motivo, sinal e referência (D-11)     |
| `pagamento`            | membro     | officer marca pago; valor = saldo                  |

Saldo devido = Σ (`premio` + `restituicao_*` + `ajuste`) − Σ `pagamento` da conta.
**Pagar** = travar o `BetSlip` da conta, calcular o saldo, inserir `pagamento`. Pagamento
nunca reescreve prêmio; ajuste depois de pago gera saldo novo e outro `pagamento`.
Refund de slip **recusado** com depósito real: OQ-54. Saldo negativo: OQ-52.

**Append-only no PostgreSQL (D-37) — proposta:**

1. **Trigger** `BEFORE UPDATE OR DELETE ON "GoldLedgerEntry" FOR EACH ROW` que lança
   exceção, mais `BEFORE TRUNCATE … FOR EACH STATEMENT`. Funciona com o único usuário de
   banco que o projeto tem hoje e vale para qualquer caminho: service, `psql`, script.
2. **Futuro endurecimento**, quando houver usuário de banco separado para migration e
   para a app: `REVOKE UPDATE, DELETE, TRUNCATE` do usuário da app. Hoje não é possível
   — a app e a migration usam o mesmo `DATABASE_URL`.

Limites conhecidos: superusuário e `session_replication_role = replica` desligam
triggers. É a mesma fronteira do `psql` em produção, já tratada como acesso restrito.

**Reconciliações verificáveis:** por mercado resolvido **sem redistribuição** (§8.6),
Σ `premio` + `receita_guilda` + `residuo_guilda` = `V` e Σ `premio` ≤ `P`; com
redistribuição, a mesma igualdade vale somando os mercados não anulados da rodada; por `VOID`, Σ `restituicao_anulado` = `V`;
por rodada liquidada, antes de ajustes, Σ `deposito_validado` = Σ (`premio` +
`restituicao_anulado` + `receita_guilda` + `residuo_guilda`).

### 16.7 `RoundClosingReport`

Documento publicado e versionado, **não** fonte contábil: `roundId`, `version`,
`auditId`, `ledgerThroughEntryId` (marca d'água), `content`, `publishedBy*`,
`publishedAt`. `content` é JSON validado pelo schema **publicado** do shared — é um
documento lido inteiro e congelado (precedente: `payload` do `LootSessionEvent`); as
**escolhas** das apostas, que a D-28 exige relacionais, continuam relacionais.

Mostra: mercados, resultados, vencedores, quanto cada vencedor ganhou em cada mercado,
`VOID`, resumo do Guild Bank, total devido por membro. **Gerado de** `BetMarketResult*` +
`GoldLedgerEntry` (o `premio` carrega `slipId` e `marketId`) + `BetMarket` — **sem ler**
`Bet`, `BetWeeklySelection`, stake ou `expectedTotal`. Não mostra stake, apostas
perdedoras, escolhas, slip nem valor depositado. Identidade pública do vencedor: OQ-51.

### 16.8 Trilha de auditoria sem duplicação

| Ação                          | Onde fica registrado (ator + horário)                                   | `BetEvent`?                    |
| ----------------------------- | ----------------------------------------------------------------------- | ------------------------------ |
| configurar em PREPARATION     | linhas de configuração têm `createdBy/updatedBy`, mas **remoção apaga** | **sim** — create/update/delete |
| Ready bem-sucedido            | `BetRound.readyAt/readyBy*` + snapshots                                 | não                            |
| Ready que falhou              | nada é gravado (atômico)                                                | **sim** — motivo da falha      |
| Submeter pagamento            | `BetSlip.submittedAt` (ator = dono)                                     | não                            |
| confirmar / recusar depósito  | `BetSlip.validated*` / `rejected*`, escritos uma vez                    | não                            |
| expiração                     | `BetSlip.expiredAt` (ator = sistema)                                    | não                            |
| Auditar                       | `BetAudit.startedBy*`                                                   | não                            |
| seleção/revisão de report     | `BetAuditSource.resolvedBy*`                                            | não                            |
| confirmar resultado           | `BetAudit.confirmedBy*`                                                 | não                            |
| settlement, pagamento, ajuste | `GoldLedgerEntry` (ator, horário, motivo)                               | não                            |

Rascunho (Salvar) não é auditado: é privado e anterior a qualquer compromisso.

### 16.9 Autorização: duas superfícies

| Superfície           | Backend                                                                                                                                                    | Front                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Apostas** (membro) | `RosterGuard` (acesso ao site) **+** checagem de domínio: a conta tem personagem associado em `BetRoundBettor` da rodada (e a FK do slip garante no banco) | `/interno/bet`                                                                   |
| **Officer Panel**    | controller próprio com `OfficerGuard` em todas as rotas                                                                                                    | rota de officer, escondida para quem não é officer (UX, não segurança — Regra 5) |

- **O próprio dado, e só ele:** métodos de repository do lado privado recebem o
  `ownerUserId` da sessão; nenhuma rota de membro aceita id de slip de outra pessoa.
- **DTO de depósito** (officer): membro, personagem depositante, total esperado, status —
  montado só de `BetSlip`, sem join em `Bet`. Não decide a OQ-48.
- Aceite de toda rota de officer: sem cookie → 401; membro → 403 (Regra 5).

### 16.10 Projected payout sem expor apostas

Uma consulta agregada no repository, sobre apostas de slips `valido`:

```
por mercado:  V = Σ stake;  P = floor(9V/10)
por opção:    S(o) = Σ stake da opção;  projected(o) = P / S(o)   ("—" se S(o) = 0)
```

O contrato publicado devolve **só** o multiplicador por opção (e, se a tela quiser, `V`
do mercado). Nunca `userId`, slip, stake individual ou lista de apostas. A consulta é
`GROUP BY`; nenhuma linha individual sai do repository.

Weekly Progression: a opção é um **conjunto** exato. Listar todos os conjuntos com
aposta publicaria, de forma anônima, as seleções privadas de alguém — OQ-55.

### 16.10a Como os snapshots respondem historicamente

| Pergunta                                    | Resposta, sem consultar fonte externa                         |
| ------------------------------------------- | ------------------------------------------------------------- |
| este personagem podia apostar nesta rodada? | existe `BetRoundBettor(roundId, characterId)`                 |
| por que esta conta pôde apostar?            | `BetSlip.eligibilityCharacterId`                              |
| este personagem era candidato?              | existe `BetRoundCandidate(roundId, characterId)`              |
| com que role?                               | `BetRoundCandidate.role`                                      |
| de quando era o dado?                       | `BetRound.bettorSourceFetchedAt` / `candidateSourceFetchedAt` |

### 16.11 Invariantes pedidas — onde cada uma é garantida

| Invariante                                        | Garantia                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| uma `BetRound` por reset                          | unique `period`                                                                                                       |
| Ready antes de apostar                            | trigger `titanbet_slip_aberto`                                                                                        |
| Ready atômico                                     | leitura externa validada antes; snapshots + `readyAt` numa transação                                                  |
| configuração imutável depois do Ready             | trigger `titanbet_config_congelada`                                                                                   |
| snapshots congelados no Ready                     | trigger `titanbet_snapshot_imutavel`                                                                                  |
| nenhuma consulta posterior redefine elegibilidade | não existe caminho de escrita nos snapshots depois do Ready                                                           |
| só bettor do snapshot aposta                      | FK `(roundId, eligibilityCharacterId)` → `BetRoundBettor` + personagem pertence à conta (aplicação, `GuildCharacter`) |
| só candidate do snapshot é alvo, na role certa    | FK `(roundId, targetCharacterId, targetRole)` + CHECK de role por tipo                                                |
| não-officer nunca acessa o Officer Panel          | `OfficerGuard` no controller de officer                                                                               |
| membro só vê o próprio dado privado               | repository filtra por `ownerUserId` da sessão                                                                         |
| odds visíveis sem expor apostas                   | consulta agregada; contrato só com multiplicador (§16.10)                                                             |
| ≤ 1 slip ativo; N recusados                       | índice parcial por status                                                                                             |
| ≤ 1 Bet por slip/mercado; um stake por Bet        | unique `(slipId, marketId)`; `stake` é coluna                                                                         |
| escolha simples = exatamente um alvo; Weekly 0..N | CHECK na `Bet`; `BetWeeklySelection` com FK composta                                                                  |
| Salvar mantém editável; Submit congela            | trigger `titanbet_aposta_editavel` + `titanbet_slip_transicao`                                                        |
| `PENDING_DEPOSIT` não edita; `REJECTED` terminal  | idem                                                                                                                  |
| novo slip após recusa só antes do cutoff          | índice parcial + trigger `titanbet_slip_aberto`                                                                       |
| cutoff terça 12:00                                | `cutoffAt` imutável + triggers                                                                                        |
| só `VALID` entra no pool                          | settlement e odds filtram `valido` (service; testado)                                                                 |
| mercados semanais; terça/quinta só evidência      | `BetMarket` sem relação com sessão; `BetAuditSource.session` enum de 2                                                |
| só `titanbet*`                                    | service da auditoria; `reportTitle` gravado como prova                                                                |
| auditoria semanal consome os dois reports         | `BetAudit` 1 : 0..2 `BetAuditSource`                                                                                  |
| First Death de progressão agrega a semana         | algoritmo sobre as fontes da auditoria; evidência por try com a sessão                                                |
| ledger append-only                                | trigger `titanbet_append_only`                                                                                        |
| Closing Report não é ledger                       | documento com marca d'água; nenhum valor novo nasce nele                                                              |
| contratos publicados sem dado privado             | `published` do shared não importa `betting`                                                                           |

### 16.12 Pronto para implementação

Nenhuma OQ aberta muda uma constraint da primeira migration (§13). O que a primeira
migration introduz de novo no projeto — CHECK constraints e triggers — está aprovado
(D-37) ou justificado aqui (triggers, §16.4).
