# Site da Guilda

Site da guilda de World of Warcraft: landing pública com formulário de apply, e área interna para guild management.

Projeto de dois devs, desenvolvido com Claude. **As regras abaixo existem para que as duas pessoas e as duas sessões de Claude produzam a mesma arquitetura.** Se uma decisão contradiz este arquivo, o arquivo ganha — ou o arquivo é atualizado explicitamente.

Planejamento no Linear: projeto **Site da Guilda**, time `TIT`.

## Estrutura

```
titan-site/
├─ apps/
│  ├─ web/          Next.js 16 (App Router) + React 19 + Tailwind 4
│  └─ api/          NestJS 11 + Prisma
├─ packages/
│  └─ shared/       contrato: tipos + schemas Zod
└─ tsconfig.base.json
```

## Regra 1 — A fronteira Next ↔ Nest

**Toda regra de negócio e todo acesso a banco vivem no Nest.** O Next renderiza e consome a API.

Route handlers do Next são permitidos **apenas** para o que é genuinamente do browser:

- cookie de sessão
- recebimento de webhook
- upload de arquivo

Qualquer outra coisa (query no banco, chamada às APIs da Blizzard, validação de negócio, envio de notificação) é endpoint no Nest.

Por quê: sem essa linha, em duas semanas metade da lógica está duplicada nos dois lados e não existe fonte da verdade. Com dois devs trabalhando em paralelo, isso acontece rápido.

## Regra 2 — O contrato mora no shared

Todo DTO de request e response nasce como schema Zod em `packages/shared`.

```ts
// packages/shared/src/application.ts
export const createApplicationSchema = z.object({ ... });
export type CreateApplication = z.infer<typeof createApplicationSchema>;
```

- O Nest valida com esse schema (ZodValidationPipe).
- O form do Next usa **o mesmo** schema no resolver.
- **Nunca** redeclarar o mesmo campo nos dois apps.

Se o back mudar um campo e o front não souber, é o typecheck que tem que quebrar — não o usuário.

### Como o shared chega nos apps

`packages/shared` é compilado com `tsup` (ESM + CJS + `.d.ts`), não consumido como TS cru. O `pnpm dev` da raiz já sobe o watch antes dos apps — não precisa rodar nada à mão.

Se mexer no shared e o app não ver a mudança, o watch morreu: `pnpm --filter @titan/shared build`.

`zod` é `external` no tsup de propósito. Embutir criaria duas instâncias do zod e `instanceof ZodError` pararia de funcionar no Nest.

## Regra 3 — Estrutura de módulo no Nest

Um módulo por domínio (`officers`, `attendance`, `auth`), cada um com:

```
src/officers/
├─ officers.module.ts
├─ officers.controller.ts    ← só HTTP: rota, status, serialização
├─ officers.service.ts       ← regra de negócio
└─ officers.repository.ts    ← único lugar que toca o Prisma
```

- Regra de negócio no **service**, nunca no controller.
- `PrismaClient` só no **repository**. Nenhum service importa Prisma direto.

**Domínio que não persiste não tem repository.** A candidatura é o caso: ela entrega no Discord e não grava nada (ver a Regra 4), então o módulo tem controller e service e mais nada. A ausência é a garantia arquitetural — não "completar o padrão" criando um repository vazio.

## Regra 4 — Acesso por rank, agregado por pessoa

**Três estados, não dois:**

| Estado            | Quem é                          | Área interna | Formulário de apply |
| ----------------- | ------------------------------- | ------------ | ------------------- |
| não-membro        | nenhum personagem no roster     | não          | **sim**             |
| membro sem acesso | no roster, rank acima do corte  | não          | não                 |
| membro            | no roster, rank dentro do corte | **sim**      | não                 |

O corte é por `guildRank`, vindo de `GUILD_RANK_ACCESS_MAX`. **Rank 0 é o mais alto** — é o guild master — e o número cresce descendo a hierarquia, então o teste é `rank <= corte`. Use `canAccessInternalArea()` do shared; nunca escreva o número na regra de negócio.

Distribuição real do roster em 30/07/2026, que é o que justifica o corte em 4:

| rank      | 0   | 1   | 2   | 3   | 4 (Raider) | 5   | 6   | 7   |
| --------- | --- | --- | --- | --- | ---------- | --- | --- | --- |
| chars     | 1   | 1   | 3   | 4   | 17         | 123 | 52  | 389 |
| acumulado | 1   | 2   | 5   | 9   | **26**     | 149 | 201 | 590 |

O salto de 26 para 149 no rank 5 é a fronteira entre o time de raid e o resto da guilda.

O estado do meio existe por um motivo específico: um social que está na guilda há dois anos não pode receber a tela de "candidate-se para entrar na guilda". Colapsar ele em não-membro é ofensivo e faz o site parecer quebrado.

### Por pessoa, não por personagem

Uma conta tem **N personagens** no roster. O rank da pessoa é o **melhor** (menor número) entre todos eles.

Isso não é refinamento, é correção: quem verifica um personagem só revoga acesso de membro legítimo quando um alt sai da guilda. O erro é silencioso — ninguém recebe erro, a pessoa só descobre que perdeu o acesso.

Pela mesma razão, só perde membership quem **não tem nenhum** personagem no roster.

### Isto reverteu uma decisão anterior

Até 30/07/2026 o acesso era binário e `guildRank` era gravado mas nunca usado, porque o roster misturava alts, raiders e social e ninguém tinha decidido onde termina "oficial".

A liderança reorganizou os ranks da guilda. A premissa caiu, e a regra mudou junto. Registrado aqui em vez de apagado, para ninguém refazer o raciocínio antigo achando que é novo.

### O rank é posicional — cuidado permanente

`rank` é a **posição** do rank na lista da guilda, não uma identidade. Se a liderança inserir ou reordenar um rank no jogo, o número 4 passa a significar outra coisa e o acesso muda sozinho, **sem erro nenhum**.

E não dá para detectar automaticamente: o roster da Blizzard devolve `rank` só como número, sem nome.

**O que segura a régua é a definição combinada, não o código: rank 4 é Raider.** Reorganizar ranks no jogo é uma decisão da liderança, e ela vem junto com revisar este corte.

O job loga a distribuição por rank a cada rodada, mas isso é **registro, não alarme**: com ~590 membros a contagem oscila toda semana com entrada e saída, então variação não significa nada. O valor é forense — se um dia o acesso ficar estranho, o histórico mostra em que rodada a estrutura mudou de formato.

Por isso o corte é configuração, nunca constante no código.

### Candidatura não é dado do site — é mensagem no Discord

**Decisão de 09/08/2026. Alvo, ainda não implementado — ver `docs/specs/discord-apply-flow.md`.**

A candidatura **não é gravada em lugar nenhum**. O formulário público posta no Nest, o Nest valida, sanitiza e entrega **uma mensagem num canal privado do Discord**. Não existe tabela, não existe status, não existe painel de review.

O cuidado que motivava o painel continua existindo, só mudou de lugar. Candidatura contém Discord tag, Battle.tag e texto que a pessoa escreveu esperando que só a liderança lesse. Antes o vazamento seria dar a tela ao membro errado; agora é **mandar para o canal errado**. Ou seja: **a permissão do canal do Discord é o controle de acesso**, e configurá-la errado é a nova versão do mesmo erro. O canal é privado, restrito à liderança, e a URL do webhook é segredo de backend.

#### Isto reverteu uma decisão anterior

Até 09/08/2026 a arquitetura prevista era `POST /applications` gravando no Postgres, com status (`pending`/`reviewing`/`accepted`/`rejected`) e um painel interno gated por `canReviewApplications()`. **Nada disso chegou a ser implementado** — não houve model, migration nem endpoint; existia como plano aqui e no Linear.

A troca aceita um custo real, e é melhor tê-lo escrito: **sem persistência não há garantia de entrega**. Se o Discord estiver fora no momento do envio, aquela candidatura se perde — não há registro para reprocessar. Isso contraria a letra da Regra 7 ("o que é durável, guarda") para este dado específico, e foi aceito conscientemente: a liderança já recruta pelo Discord, e um segundo inbox que ninguém abre não vale o custo. Por isso o caminho de falha tem que ser **honesto** — nunca responder sucesso para uma mensagem que não chegou.

Registrado aqui em vez de apagado, para ninguém refazer o raciocínio antigo achando que é novo. Consequência prática: `canReviewApplications()` saiu do shared, e o formulário de apply não tem qualquer relação com o banco.

#### O que sobrevive intacto

Ser **oficial** continua sendo marcação **manual**, deliberadamente **não** derivada do rank, e continua gateando o que a Regra 7 protege (histórico de outra pessoa) e a própria lista de oficiais. Os dois gates seguem independentes: passar do corte te dá a área interna, não as decisões de liderança.

### Oficial é concessão por personagem, não coluna na conta

**Não existe `User.isOfficer`.** A fonte da verdade é a tabela `OfficerGrant`, uma linha por **personagem** (`nameKey` + `realmSlug`), gerenciada em `/interno/oficiais`. Ser oficial é derivado a cada leitura de sessão por `isOfficerByGrants()`, que casa os personagens da conta contra os grants.

**Por personagem, e não por conta**, porque `User` só existe depois do primeiro login OAuth — e a liderança precisa poder preparar a lista antes disso. Quando isso foi montado, 4 dos 5 oficiais nunca tinham logado no site: uma tela que listasse contas mostraria uma linha só.

**Derivado na leitura, sem cópia gravada**, por duas razões:

- revogar vale na hora, na requisição seguinte — mesma lógica do cookie de sessão com estado no banco em vez de JWT;
- não existe estado em que a flag da conta e a lista discordam.

Custa uma consulta numa tabela de poucas linhas por requisição interna, e paga.

A agregação é a mesma do resto da Regra 4: **qualquer** personagem da conta que case com **qualquer** grant basta.

#### Três permissões, uma precondição

| Função                  | Decide                                             |
| ----------------------- | -------------------------------------------------- |
| `isActingOfficer()`     | precondição comum — é o que o `OfficerGuard` checa |
| `canSeeOthersHistory()` | histórico de outra pessoa (Regra 7)                |
| `canManageOfficers()`   | conceder e revogar oficial                         |

As duas últimas têm o mesmo corpo hoje e continuam separadas de propósito: são decisões diferentes sobre dados diferentes, e uma pode mudar sem a outra. Delegar à precondição não é colapsar — mudar uma permissão é substituir o corpo dela, sem tocar na outra.

Havia uma quarta, `canReviewApplications()`, para o painel de candidaturas. **Ela foi removida** junto com a promessa de persistência: sem painel, era uma permissão sem objeto — e permissão órfã convidaria alguém a construir o objeto. Ver `docs/specs/discord-apply-flow.md`.

Guard genérico checa a **precondição**, nunca uma das específicas. Um guard que checasse `canSeeOthersHistory()` para proteger a lista de oficiais passaria a mentir no dia em que as duas divergissem, e o jeito de descobrir seria pelo acesso indevido.

#### Conceder valida contra o roster

Nome que não está no roster é recusado, e nome ambíguo também. Um grant com nome errado é indistinguível de um certo até a pessoa tentar entrar e não conseguir — e ninguém relaciona as duas coisas semanas depois. Já aconteceu: um nome passado pela liderança não existia no roster.

Ambíguo é o caso do `toSlug()` da Regra 6: `Shrëwd`, `Shrêwd` e `Shrèwd` colapsam na mesma chave e são pessoas diferentes, com ranks diferentes. A tela lista as grafias e exige a exata em vez de escolher uma sozinha. O que fica gravado é a grafia da **Blizzard**, não a digitada, porque é ela que precisa casar com o `GuildCharacter` do login.

Revogar o **último** oficial é recusado: a tela é gated por oficial, então zerar a lista tranca todo mundo para fora e o conserto vira `INSERT` manual em produção.

#### Isto substituiu a flag no usuário (09/08/2026)

Até aqui `isOfficer` era coluna no `User`, e **nenhum caminho no código escrevia nela** — promover era `UPDATE` no psql, sem registro de quem decidiu.

Foi cogitado derivar de "oficial para cima" no rank, e descartado. Não existe "oficial para cima" legível: o roster devolve `rank` só como número, sem nome, então viraria `rank <= N` com N escolhido hoje — e a Regra 4 já avisa que rank é posicional. Some-se a agregação pelo melhor rank, e qualquer pessoa com um alt em rank alto viraria oficial. Na distribuição real da época, os 5 oficiais eram exatamente os ranks 0–2, mas o rank 3 tinha 4 personagens que não eram oficiais: a fronteira é julgamento humano, não propriedade do roster.

Registrado aqui em vez de apagado, para ninguém refazer o raciocínio antigo achando que é novo.

## Regra 5 — Autorização é no Nest, sempre

O proxy do Next que protege `/interno/*` é **UX, não segurança**. Ele evita tela quebrada.

Todo endpoint interno precisa do seu próprio guard no Nest. Um endpoint que depende só do proxy do Next é chamável com `curl` por qualquer pessoa.

O arquivo é `apps/web/proxy.ts`. Chamava-se `middleware.ts` até o Next 16 renomear a convenção — e renomeou justamente porque gente demais usava middleware como camada de autorização. A doc do Next agora diz, com todas as letras, que proxy "should not be used as a full session management or authorization solution". É esta regra, dita por eles.

Ao criar endpoint interno, o teste não é "a UI esconde?" — é "chamado sem cookie devolve 401?".

## Regra 6 — Chamadas a APIs externas

Blizzard, Raider.IO e WarcraftLogs são chamadas **só pelo Nest**, nunca pelo browser.

- As credenciais da Blizzard não podem ir para o bundle do front.
- O cache tem que ficar em um lugar só. Sem cache, cada visita na home queima rate limit — e o dado muda no máximo uma vez por semana.
- Falha de API externa não pode derrubar página: degradar para o último dado bom ou esconder a seção.

### Região: US, fixa

A guilda é **exclusivamente região US**. A região vem de `BLIZZARD_REGION` e de nenhum outro lugar — nenhum formulário do site pergunta região. Quem pede personagem digitado usa `characterInputSchema` (sem região) justamente por isso; é o caso de `createOfficerGrantSchema`.

(O `createApplicationSchema` **não** usa mais esse schema: o commit `38c1dd5`, de 06/08/2026, simplificou a candidatura para campos de texto livre. Continua sem região, que é o que esta regra exige.)

Não existe "bloquear outras regiões" como código separado: a verificação de membership é a interseção com o roster da guilda, que só existe em US. Conta de outra região não tem personagem nesse roster e já não entra.

**Nunca inferir região de IP, idioma do navegador ou nacionalidade.** Região US não quer dizer jogadores americanos — realms brasileiros (Azralon, Goldrinn, Nemesis, Tol Barad) são região US, e um membro legítimo pode morar na Europa e jogar em US. Filtro por geolocalização barraria membros de verdade.

### Normalização de nomes — quatro funções, não uma

Nunca compare string crua. Mas cada caso usa uma função diferente, e trocar uma pela outra é bug silencioso.

| O quê                                 | Função                  | Acento     | Separador  |
| ------------------------------------- | ----------------------- | ---------- | ---------- |
| Realm (banco, URL da Blizzard)        | `toSlug()`              | remove     | mantém     |
| Realm **comparado entre ferramentas** | `toRealmMatchKey()`     | remove     | **remove** |
| Boss **comparado entre ferramentas**  | `toEncounterMatchKey()` | remove     | **remove** |
| Personagem vindo da API               | `toCharacterKey()`      | **mantém** | —          |
| Nome digitado por uma pessoa          | `toSlug()`              | remove     | mantém     |

**Realm** precisa de `toSlug()` porque a Blizzard devolve `area-52` em alguns endpoints e `Area 52` em outros.

**Realm entre ferramentas diferentes precisa de mais.** Cada uma escreve realm composto do seu jeito:

| fonte               | Area 52   | Demon Soul   |
| ------------------- | --------- | ------------ |
| Blizzard / WoWAudit | `Area 52` | `Demon Soul` |
| Warcraft Logs       | `Area52`  | `DemonSoul`  |

Pelo `toSlug()` isso vira `area-52` de um lado e `area52` do outro, e o casamento falha **em silêncio**. Descoberto cruzando presença: na noite de 28/07/2026, Decenty-DemonSoul e Kusiak-Area52 estavam no log e seriam gravados como "Não Raidou" — acusação de furo contra quem raidou, que é exatamente o erro que a Regra 7 diz que a liderança não perdoa.

Não é caso de borda: **58 dos 344 realms US** têm hífen no slug, e o time é cross-realm.

`toRealmMatchKey()` tira todo separador. Verificado contra o índice de realms da Blizzard: os 344 realms US geram 344 chaves distintas, **zero colisão** — colapsar separador não junta realms diferentes. O que vai para o banco e para a URL da Blizzard continua sendo `toSlug()`.

**Nome de boss entre ferramentas tem o mesmo problema, com outra pontuação.**

| fonte             | boss                          |
| ----------------- | ----------------------------- |
| Encounter Journal | `Chimaerus the Undreamt God`  |
| Warcraft Logs     | `Chimaerus, the Undreamt God` |

Uma vírgula. Em 09/08/2026 ela reprovou a carga de The Dreamrift com um `dungeonEncounterId` **correto**, vindo do cliente do WoW: a conferência do carregador comparava nome cru e virou falso negativo, travando a raid inteira.

`toEncounterMatchKey()` colapsa pontuação, e isso **não** afrouxa a verificação — que é o ponto dela. `Kazzara, the Hellforged` e `The Forgotten Experiments` continuam diferentes sob qualquer normalização, então id apontando para outro boss continua barrado. O nome que vai para o banco e para a tela é o do Encounter Journal, sem passar por aqui.

**Personagem vindo da API precisa manter o acento.** WoW não permite dois personagens com o mesmo nome no mesmo realm, então quem chega e encontra o nome ocupado registra uma variação acentuada dele. O acento não é enfeite — é como a pessoa conseguiu o nome que queria. São personagens diferentes, com ranks diferentes, e não é caso raro: no roster da Titan Inc existem 7 grupos assim.

Daí a regra que vale para qualquer identificação de personagem no sistema: **sempre o par nome + realm**, nunca o nome sozinho — em chave de banco, em lookup e na tela.

```
azralon/Shrëwd (rank 5) · Shrêwd (rank 5) · Shrèwd (rank 7)
azralon/Jöci   (rank 7) · Joci   (rank 5) · Jôci   (rank 7)
```

Com `toSlug()` os três viram `shrewd`. Num `Map` de lookup só o último sobrevive, e a pessoa passa a ser lida com o rank de um personagem que não é dela — que é justamente o que decide acesso pela Regra 4. Falha em silêncio e parece que funcionou.

`toCharacterKey()` normaliza só o que a Blizzard de fato varia entre endpoints: forma Unicode (NFC) e capitalização.

**Nome digitado em formulário continua no `toSlug()`**: ali tolerar acento é desejável, porque ninguém deve perder um apply por causa de trema.

## Regra 7 — O site é o registro, o Discord é a interface

A guilda tem ~590 membros e boa parte não é engajada. Funcionalidade de área interna que só funciona se as pessoas abrirem o site com frequência **não vai funcionar**.

- O que é oportuno, empurra (site → Discord).
- O que é durável, guarda (site).
- Todo post no Discord linka fundo, na página exata, nunca na home.
- Nada que o Discord já resolva deve exigir o site.

O site ganha das outras ferramentas em uma coisa só, e é nela que vale investir. WoWAudit planeja raid, WarcraftLogs analisa pull, Raider.IO mede M+ — nenhum deles responde "como essa pessoa se comportou na nossa guilda nos últimos 6 meses", porque isso exige juntar as três fontes com os nossos próprios eventos de roster, ao longo do tempo. Não refazer o que essas ferramentas já fazem bem.

### Gravar vem antes de exibir

As APIs externas respondem o **estado atual**. Nenhuma delas responde "como estava em março". A linha do tempo da guilda só existe se a gente estiver gravando desde antes de alguém pedir.

Por isso job de gravação (evento de roster, snapshot semanal) entra **antes** da tela que mostra o dado, mesmo parecendo trabalho sem entrega visível. Tela atrasada se constrói depois; semana não gravada não volta.

Corolário: falha de coleta é **lacuna**, nunca zero. Gravar 0 porque a API caiu vira "a pessoa parou de jogar" — mentira que o gráfico conta com cara de verdade.

### Derivar automático, humano corrige, guardar a correção

Vale para tudo que gera dado sobre o comportamento de uma pessoa.

O caso concreto: quem foi para o banco e quem furou a raid são **indistinguíveis** no log — os dois simplesmente não aparecem em pull nenhuma. E significam coisas opostas.

Então o sistema grava o fato observável ("Não Raidou") e oferece ao raid leader anotar o motivo depois. O que fica no banco é a correção do humano, nunca a inferência. Sistema que decide sozinho a reputação de alguém erra em público, e a liderança para de confiar nele.

### Visibilidade do histórico

Mesma lógica de "oficial é gate próprio" da Regra 4, aplicada ao histórico:

- **Oficial** vê o detalhe de qualquer pessoa.
- **Membro** vê o próprio histórico, inteiro.
- **Membro não vê o histórico de outro membro.**

Presença, loot e evolução são dados sobre pessoas reais que ninguém combinou tornar públicos ao entrar na guilda. Ranking público de falta gera treta e não ajuda o RL a decidir nada — ele já tem o detalhe.

## Comandos

```bash
pnpm install              # na raiz

pnpm dev                  # shared (watch) + web + api, tudo junto
pnpm dev:web              # só o Next
pnpm dev:api              # só o Nest

pnpm typecheck            # todos os workspaces
pnpm lint
pnpm test
pnpm format

pnpm build                # todos, na ordem de dependência
```

## Fluxo de git

Repo: https://github.com/titan-inc/titan-site (público). Transferido da conta pessoal do Leonardo pra esta organization em 10/08/2026, pra permitir Admin por pessoa (necessário pra configurar Actions/secrets) — repositório pessoal tem teto de Write/Maintain por colaborador, sem exceção.

`main` é protegida por ruleset: nada de push direto, nada de force-push, nada de deletar a branch, e o check `verify` do CI é obrigatório. Todo trabalho entra por PR.

```bash
git switch -c leonardodasilveira/tit-15-formulario-de-apply-em-apply
# ... trabalho ...
git push          # push.autoSetupRemote já cria o upstream
gh pr create
```

**Nome da branch vem do Linear.** Cada issue tem um `gitBranchName` pronto (botão de copiar na issue). Usar esse nome faz o Linear ligar branch, PR e issue automaticamente, e mover a issue de status sozinho. Inventar nome de branch quebra essa ligação.

O CI (`.github/workflows/ci.yml`) roda no PR: formatação, lint, build, typecheck e testes. Merge só com CI verde.

Review do outro dev é bem-vindo, mas não obrigatório — em dupla, review obrigatório trava quando um dos dois está offline.

Antes de abrir PR, rodar localmente o que o CI roda, **nesta ordem**:

```bash
pnpm format:check && pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

**Pare o `pnpm dev` antes de rodar `pnpm build`.** Os dois escrevem em `apps/api/dist`: o build limpa o diretório e o watch morre com `Cannot find module dist/main`, que não sugere a causa.

`pnpm build` vem **primeiro** porque lint e typecheck dependem do `packages/shared` compilado. O typecheck por motivo óbvio; o lint porque as regras do `typescript-eslint` são type-aware — sem o `dist`, tudo que vem do `@titan/shared` resolve como tipo de erro e o lint acusa `no-unsafe-*` em código correto.

Localmente a ordem errada passa, porque o `dist` sobrou de um build anterior. Só quebra em clone limpo, ou seja, só no CI.

## Segredos

**Este repositório é público.** Segredo commitado aqui está exposto no instante do push, e apagar depois não resolve — o histórico do git guarda, e forks e scrapers podem já ter copiado.

Nada de credencial no repositório. Tudo em `.env` local, documentado em `.env.example` com valores vazios.

Nunca commitar: `DATABASE_URL` de produção, `BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`, `SESSION_SECRET`, `DISCORD_APPLY_WEBHOOK_URL`.

A URL do webhook do Discord carrega o próprio token no caminho: quem tem a URL posta no canal. Ela é segredo **de backend** — nunca com prefixo `NEXT_PUBLIC_`, que o Next embute no bundle do browser. Se vazar, rotacionar é **apagar o webhook nas configurações do canal e criar outro**; reescrever o histórico do git não invalida a URL antiga.

Se um segredo escapar: **tratar como comprometido e rotacionar na origem** (gerar novo secret no portal da Blizzard, novo webhook no Discord). Remover do histórico é limpeza, não conserto — o valor antigo tem que morrer.

Também não versionar dado de membro ou candidatura: nada de dump de banco, print com Discord tag, ou fixture com nome real de pessoa. Usar dados fictícios em teste.

O `.env.example` pode ter placeholder local (`postgresql://titan:titan@localhost:5432/...`) — é credencial de banco de desenvolvimento na sua máquina, não vale nada fora dela. Nunca colocar ali um valor que funcione em produção.

## Aviso sobre o Next 16

`apps/web/AGENTS.md` (gerado pelo `create-next-app`) avisa que esta versão do Next tem breaking changes em relação ao conhecimento pré-treinado, e manda ler `node_modules/next/dist/docs/` antes de escrever código.

**Respeitar isso.** Antes de mexer em App Router, cache, `use cache`, route handlers ou config, ler o guia relevante em `node_modules/next/dist/docs/` em vez de assumir a API de memória.

## Decisões já tomadas (não reabrir sem motivo)

| Decisão | Escolha                              | Motivo                                                                                                              |
| ------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Front   | Next.js, não Vite/SPA                | existe landing pública que precisa de SEO **e** área logada                                                         |
| Back    | NestJS                               | um dos devs já domina                                                                                               |
| Auth    | Battle.net OAuth2                    | verifica membership de verdade via roster; zero senha para guardar                                                  |
| Sessão  | cookie de sessão com estado no banco | permite revogar acesso na hora quando alguém sai da guilda; JWT sem revogação deixaria ex-membro dentro até expirar |
| Banco   | PostgreSQL + Prisma                  | melhor DX com Nest, tipos gerados                                                                                   |
| Deploy  | Docker por app                       | destino ainda não decidido; portável entre PaaS e VPS                                                               |
