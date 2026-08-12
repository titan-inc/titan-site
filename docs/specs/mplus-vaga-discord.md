# M+: anúncio de vaga no Discord

> **Status: APROVADA, não implementada.** Escrita em 12/08/2026 contra `origin/main`.
> Linear: **TIT-117** (desenho), **TIT-118** (implementação).
>
> A decisão que estava em aberto foi tomada em 12/08/2026 e está na seção 5:
> persistir, com expurgo automático em 7 dias.

---

## 1. Objetivo

Um grupo de M+ com vagas abertas descreve o que precisa numa tela do site; o Nest valida e
posta **uma mensagem num canal do Discord dedicado a M+**. Quem topa responde no canal. O
grupo fecha na mão.

Não é matchmaking. O sistema não escolhe ninguém, não monta grupo e não decide composição.

## 2. O problema

Montar grupo de M+ trava em **alinhar agenda**, não em achar gente. A guilda é pequena e
quando todo mundo está no Discord os grupos surgem sozinhos. O que falta é o anúncio alcançar
quem toparia, no momento em que ainda dá tempo.

O caso concreto que originou isto: três pessoas na mesma casa, o grupo já nasce com **tank +
2 dps**, querem jogar **amanhã à noite**, e falta **1 healer e 1 dps**.

### O que o site ganha das outras ferramentas

Nada, em achar estranhos — o group finder do jogo e o do Raider.IO fazem isso melhor e é
exatamente o que a Regra 7 manda não refazer. O produto aqui é **parar de pugar**: o anúncio
circula entre gente conhecida, com o que o grupo já tem e o que falta explícito.

O canal de LFG solto no Discord falha porque não tem estrutura: "alguém pra key?" não diz
quando, qual role falta, nem se tem lust. A tela existe para que essas perguntas não fiquem
sem resposta, não para ser mais bonita que uma mensagem digitada.

---

## 3. A forma: vaga, não perfil

**O primitivo é o grupo com buracos nomeados**, não a pessoa cadastrada.

Consequência que decide o desenho: **a vaga expira sozinha**. Uma vaga para amanhã 21h morre
às 21h de amanhã. Não existe dado velho que ninguém percebe que envelheceu — que é o defeito
que reprovou as duas alternativas da seção 4.

### Divisão de esforço

| Quem            | Precisa abrir o site? |
| --------------- | --------------------- |
| Cria a vaga     | **sim**, ~30 segundos |
| Responde à vaga | **nunca**             |

Isto é o que faz a feature sobreviver à Regra 7. Só quem tem a necessidade abre o site, e essa
pessoa abriria de qualquer jeito — é ela que quer jogar amanhã. O lado que precisa de escala
fica inteiro no Discord.

### O canal dedicado é o filtro

Um canal só para isso é **opt-in por construção**: quem quer ver, entra; quem não joga M+, não
entra. Isso substitui qualquer targeting de ping, e é melhor que ele em todos os eixos que
importam aqui — não exige saber nada sobre ninguém e não tem como errar.

---

## 4. Alternativas descartadas

Registradas porque cada uma parece óbvia até esbarrar no motivo. Convenção do repositório:
registrar em vez de apagar, para ninguém refazer o raciocínio achando que é novo.

### 4.1 Agenda semanal de disponibilidade

A proposta original: cada pessoa declara "seg/qua 18:00-20:00", o sistema cruza e monta grupos.

**Reprovada porque apodrece em silêncio.** Uma agenda preenchida em agosto está errada em
outubro e ninguém percebe. O sistema então monta um grupo com 5 pessoas, aparecem 2, e a
confiança na ferramenta morre na primeira semana. É a mesma classe de erro que a Regra 7
descreve: dado que parece medido e não é.

Não está descartada para sempre — ver seção 10.

### 4.2 Sinal ao vivo ("tô livre agora")

Com limiar: o bot fica quieto até o 3º sinal e aí avisa o canal.

**Não reprovada, mas é outro problema.** Resolve "estou disponível agora e não vejo ninguém
online"; não resolve "quero jogar amanhã". Além disso é oportuno, não durável, então a
Regra 7 manda que viva no Discord — um comando de bot ou um canal de voz, não uma tela.

### 4.3 Inferir role a partir do Raider.IO

O perfil traz score separado por role, então dava para derivar quem cura e quem tanka sem
formulário nenhum.

**Reprovada por contraexemplo real:** tem gente que joga dps na raid e mantém um **alt tank**
que usa mais em M+. Role não é propriedade da pessoa — é do **personagem que ela vai trazer
amanhã**, e só ela sabe qual é. A inferência erraria calada, que é o pior modo de errar.

Vale como aviso geral: derivar automático é bom quando a fonte de fato responde a pergunta.
Aqui ela responde outra.

### 4.4 Derivar os buffs do grupo a partir das classes

"Não temos lust nem brez" é derivável — se o sistema souber quais personagens os 3 já
confirmados vão levar. **Reprovada pelo custo de entrada:** para derivar, a pessoa teria que
cadastrar os três personagens antes de anunciar. Marcar duas caixas é mais rápido e não pode
ficar desatualizado em relação à realidade da noite.

### 4.5 Ping direcionado por perfil

Ver "O canal dedicado é o filtro", na seção 3 — ele resolve melhor. E targeting cria um problema novo: quem for marcado
por engano silencia o canal e some para sempre, inclusive para os anúncios que interessavam.

---

## 5. Persistência: sim, com expurgo em 7 dias

**Decidido em 12/08/2026.** A vaga é gravada, quem criou pode apagar à mão, e um job apaga
sozinho o que passou de 7 dias.

Os 7 dias são **faxina, não política de retenção**: a vaga vira lixo depois que a noite passa,
e apagar à mão toda vez é trabalho que ninguém vai fazer.

### O argumento que ganhou a discussão não sobreviveu à decisão

Registrado porque é exatamente o tipo de coisa que alguém reconstrói errado meses depois.

A persistência foi defendida pelo **histórico**: com a agenda semanal (4.1) fora da mesa, o
registro de vagas seria o único caminho para um dia saber o ritmo de M+ da guilda — que dia,
que horário, que faixa de key. Regra 7, "gravar vem antes de exibir".

**Sete dias não é ritmo, é a semana passada.** Esse argumento morreu junto com a janela, e
ninguém deve construir leitura de ritmo em cima desta tabela: ela se apaga sozinha. Se um dia
quiserem isso, é decisão nova, e provavelmente outra tabela.

O que a persistência compra, e que basta para justificá-la:

- **apagar à mão** uma vaga que não vale mais — sem linha não há o que apagar;
- **uma página da vaga** para o post do Discord linkar. Regra 7: linka fundo, na página exata;
- **saber o que foi entregue**, em vez de mandar e esquecer.

### O que continua valendo do desenho sem persistência

**Sem registro não haveria garantia de entrega** — é o custo que o apply
(`docs/specs/discord-apply-flow.md`) aceitou conscientemente. Aqui a linha existe, então o
caminho de falha pode ser melhor: gravar antes de entregar e marcar o resultado depois
(seção 8). Mesmo assim, a regra da seção 9 não muda — **nunca responder sucesso para mensagem
que não chegou**.

### Apagar a linha não apaga a mensagem do Discord

O anúncio já foi entregue e fica no canal, independente do que o site faça depois. Apagar é
**tirar do site**, e a tela não pode sugerir outra coisa — quem apagar achando que retirou o
anúncio do ar vai continuar recebendo resposta no Discord.

Remover a mensagem exigiria guardar o id dela e chamar o Discord de volta, o que o webhook até
permite; **fora de escopo** e listado na seção 10.

---

## 6. Estado atual, verificado

### 6.1 O que já existe e serve

| Arquivo                                      | O que dá                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/api/src/discord/discord.service.ts`    | entrega via webhook, timeout de 10s, erros tipados por causa             |
| `apps/api/src/config/discord.config.ts`      | validação de URL de webhook (host + caminho), ausência não derruba a API |
| `apps/api/src/common/zod-validation.pipe.ts` | validação de body contra schema do shared                                |
| `docs/specs/discord-apply-flow.md` §7        | sanitização, `allowed_mentions`, limites de embed — reaproveitar inteiro |

### 6.2 O que precisa mudar no que existe

**`DiscordService` está preso ao webhook de candidatura.** `webhookUrl` é lido de
`loadDiscordConfig()` no construtor (linha 33), e as mensagens de log falam em "candidatura".
Precisa aceitar **destino** como parâmetro de `send()`, com a config expondo mais de um
webhook.

Isso é o segundo consumidor que a spec do apply antecipou ao pôr o serviço em módulo próprio.
Duas exigências ao generalizar:

1. **Nunca o mesmo canal.** O de candidatura é privado, restrito à liderança, e carrega
   Discord tag e texto pessoal de gente de fora. Vazar anúncio de M+ lá dentro é chato;
   vazar candidatura no canal de M+ é o incidente que a Regra 4 descreve.
2. Ausência do webhook de M+ **não** pode desabilitar candidatura, e vice-versa.

### 6.3 O guard que falta

`MemberGuard` (`apps/api/src/auth/session.guard.ts:32`) exige `hasInternalAccess`, ou seja
**rank dentro do corte** (`GUILD_RANK_ACCESS_MAX`, hoje 4 — 26 personagens). M+ não é raid:
rank não deve filtrar nada aqui.

O bom é que a distinção **já existe** e não precisa de corte novo. A Regra 4 define três
estados, e o do meio — "membro sem acesso: tem personagem no roster, rank acima do corte" —
hoje não recebe nada. Esta é a primeira coisa que faz sentido dar a ele:

| Régua                              | Onde                              | Quem passa            |
| ---------------------------------- | --------------------------------- | --------------------- |
| `membership === 'member'`          | **guard novo** — vale para M+     | qualquer um no roster |
| `hasInternalAccess` (rank ≤ corte) | `MemberGuard`, tudo que já existe | time de raid          |

Então: **um terceiro guard**, checando só membership, sem tocar em `MemberGuard` nem em
`GUILD_RANK_ACCESS_MAX`. E a página correspondente sai de trás do corte no proxy do Next —
lembrando a Regra 5, o proxy é UX; o guard é o que vale.

---

## 7. Contrato (`packages/shared`)

Esboço, não fechado. Regra 2: nasce aqui, e nem o Nest nem o front redeclaram campo.

```ts
// packages/shared/src/mplus.ts
export const criarVagaSchema = z.object({
  /** Quantas vagas de cada role. Pelo menos uma > 0. */
  vagas: z.object({
    tank: z.number().int().min(0).max(1),
    healer: z.number().int().min(0).max(1),
    dps: z.number().int().min(0).max(3),
  }),

  /** Instante do jogo, em UTC. Ver seção 8 sobre fuso. */
  quando: z.string().datetime(),

  /** Faixa de key como intenção, nunca como filtro — ver abaixo. */
  keyMin: z.number().int().min(2).max(40),
  keyMax: z.number().int().min(2).max(40),

  /** O que o grupo NÃO tem. Marcado à mão — ver 4.4. */
  faltando: z.array(z.enum(['lust', 'brez'])).max(2),

  observacao: z.string().max(500).optional(),
});
```

**Faixa de key é rótulo, não critério.** O grupo diz "12-14" para sinalizar se está pushando
ou fechando o dever de casa. O sistema **nunca** usa isso para esconder o anúncio de ninguém:
quem joga +18 frequentemente topa ajudar numa +12, e um filtro esconderia exatamente o convite
que seria aceito.

`vagas` precisa de um refinamento que garanta pelo menos uma vaga > 0, e `keyMax >= keyMin`.

---

## 8. Fluxo

1. Pessoa logada, com personagem no roster (6.3), abre a tela e descreve a vaga.
2. Front valida com `criarVagaSchema`; o Nest revalida com o mesmo schema — Regra 5.
3. **A linha é gravada**, ainda sem resultado de entrega.
4. O service monta o embed, sanitiza texto livre (§7 da spec do apply, sem reescrever).
5. `DiscordService.send(destino: 'mplus', payload)`.
6. O resultado da entrega é marcado na linha.
7. Discord aceitou → **201**. Falhou → erro honesto, valores preservados na tela.

Gravar **antes** de entregar é o que permite saber que existiu uma vaga cuja mensagem não
chegou. Gravar depois perderia exatamente esse caso.

### Ciclo de vida

| Evento          | Quem           | Efeito                                       |
| --------------- | -------------- | -------------------------------------------- |
| apagar à mão    | quem criou     | linha some do site; mensagem fica no Discord |
| expurgo, 7 dias | `@Cron` diário | idem, sem ninguém pedir                      |

Os 7 dias contam a partir da **criação**, não do horário marcado para a key — assim uma vaga
criada para daqui a duas semanas não some antes da hora. Se a seção 7 limitar o quanto se pode
agendar à frente, as duas janelas precisam conversar.

O job segue o padrão dos que já existem (`@Cron` em `snapshots.service.ts:60`), **não** um
script que sobe `NestFactory` — Regra 8.

### Fuso horário

Guardar e transmitir **sempre em UTC**; exibir no fuso de quem lê. A guilda é região US com
realms brasileiros, e a Regra 6 lembra que um membro legítimo pode morar na Europa. "21h" sem
fuso é ambíguo justamente entre as pessoas que precisam se combinar.

---

## 9. A mensagem

Um embed, mesma disciplina do apply:

- **título** com o essencial escaneável: o que falta e quando (`Falta healer + dps — amanhã, 21h`);
- **campos** para faixa de key, o que o grupo não tem (lust/brez) e quem está anunciando;
- `allowed_mentions: { parse: [] }` **obrigatório** — sem isso um `@everyone` digitado na
  observação dispara de verdade, pelo webhook da própria guilda;
- markdown escapado, caracteres de controle removidos, truncamento depois do escape.

Diferente do apply em dois pontos:

- **quem anuncia é membro identificado**, então o embed leva a battletag/nome de quem criou —
  sem isso ninguém sabe pra quem responder;
- **menção de cargo do canal de M+ é desejável** e é a única exceção pensável a
  `parse: []`. Se for feita, é via `allowed_mentions.roles` com o id fixo em configuração,
  **nunca** via `parse`, e nunca a partir de texto que a pessoa digitou.

### Nunca anunciar

Quem **não** entrou, quem não respondeu, quem costuma não aparecer. A Regra 7 é explícita que
sistema que decide reputação em público faz a liderança parar de confiar nele, e uma
ferramenta de grupo é uma máquina de fazer isso se deixarem.

---

## 10. Fora de escopo

- **Cadastro prévio de disponibilidade** (4.1). Se um dia voltar, volta como agenda que
  **sugere quando anunciar**, nunca como agenda que monta grupo sozinha.
- **Sinal ao vivo com limiar** (4.2) — problema diferente, e o lugar dele é o Discord.
- Inferência de role, buff ou classe a partir de API externa (4.3, 4.4).
- Ping direcionado por perfil (4.5).
- Algoritmo de composição, confirmação de presença, sugestão de convite, fechamento
  automático do grupo.
- Bot do Discord, slash command, leitura do Discord. A entrega é webhook, mão única.
- **Apagar a mensagem no Discord** quando a vaga é apagada no site. Exigiria guardar o id da
  mensagem e chamar o Discord de volta. Ver seção 5: apagar é tirar do site, e a tela precisa
  dizer isso em vez de fingir que recolhe o anúncio.
- **Leitura de ritmo de M+** — que dia e horário a guilda joga. Não dá para derivar de uma
  tabela com janela de 7 dias, e fingir que dá é pior que não ter (seção 5).
- Qualquer relação com rank de guilda, roster do WoWAudit ou o time de raid.

---

## 11. Ordem sugerida

Passos pequenos, cada um verde sozinho.

1. Generalizar `DiscordService` para múltiplos destinos + segunda variável de ambiente (6.2),
   com teste de que os destinos não se confundem.
2. Contrato no shared (seção 7) com testes de schema. `pnpm --filter @titan/shared build`.
3. Guard de membership (6.3), com o teste da Regra 5: **sem cookie devolve 401**, e membro de
   rank acima do corte **passa** (que é o ponto).
4. Model + migration da vaga.
5. Endpoint + service + módulo, com o embed e a sanitização testados (`@everyone` inerte,
   markdown escapado, truncamento), gravando antes de entregar (seção 8).
6. `DELETE` da vaga — só quem criou — e o `@Cron` de expurgo dos 7 dias.
7. Tela, incluindo dizer que apagar não recolhe a mensagem do Discord.
8. Ambiente: webhook do canal de M+ no `.env.example` (valor vazio) e no deploy. Testar contra
   **canal de teste descartável**, nunca o canal real.

Antes do PR, com o `pnpm dev` parado:

```bash
pnpm format:check && pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

---

## 12. Critérios de aceite

1. Criar uma vaga produz **exatamente uma** mensagem, no canal de M+ e em nenhum outro.
2. O webhook de candidatura e o de M+ são variáveis distintas; nenhum caminho de código
   consegue trocar um pelo outro, e um teste garante.
3. Texto livre com `@everyone`, `@here` e markdown chega **inerte**.
4. Membro de rank acima de `GUILD_RANK_ACCESS_MAX` **consegue** criar vaga; conta sem
   personagem no roster recebe 403; sem cookie recebe 401.
5. Falha do Discord produz erro honesto, com o que foi digitado preservado. Nunca sucesso para
   mensagem não entregue.
6. Faixa de key não filtra a visibilidade de nada.
7. Nenhuma URL de webhook aparece em log, em resposta de API ou no bundle do front.
8. Uma vaga cuja entrega falhou **existe na tabela**, marcada como não entregue.
9. Quem criou a vaga consegue apagá-la; **mais ninguém** consegue, e um teste garante.
10. Vaga criada há mais de 7 dias some sozinha, sem ninguém rodar nada à mão.
11. A tela deixa claro que apagar não remove a mensagem já publicada no Discord.
