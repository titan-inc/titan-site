# M+: anúncio de vaga no Discord

> **Status: PROPOSTA.** Escrita em 12/08/2026 contra `origin/main`.
> Nada aqui foi implementado. Linear: **TIT-117**.
>
> Uma decisão continua em aberto e está isolada na seção 5 — persistir a vaga ou não.
> Ela muda o tamanho da entrega, não a forma.

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

## 5. Decisão em aberto: persistir a vaga?

**Recomendação: persistir.** Mas a decisão é do time, e o resto da spec vale nos dois casos.

### A favor de gravar

Com a agenda semanal (4.1) fora da mesa, **o histórico de vagas é o único caminho que sobra**
para um dia saber o ritmo de M+ da guilda — que dia, que horário, que faixa de key. Regra 7:
"gravar vem antes de exibir", e "semana não gravada não volta". Custa uma tabela, é invisível
para quem usa e **não dá para fazer retroativo**.

### A favor de não gravar

O fluxo de candidatura (`docs/specs/discord-apply-flow.md`) escolheu deliberadamente não
persistir, e o argumento era bom: ninguém abriria um segundo inbox. Se o registro sair daqui
também, a tela perde metade da razão de existir e **isto vira um slash command de bot**, sem
front nenhum — o que é uma resposta legítima, não um fracasso.

### O custo que a versão sem persistência aceita

O mesmo do apply, e precisa estar escrito: **sem registro não há garantia de entrega**. Discord
fora do ar no momento do envio = anúncio perdido, sem reprocessamento. Daí a regra da seção 9:
nunca responder sucesso para mensagem que não chegou.

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
3. O service monta o embed, sanitiza texto livre (§7 da spec do apply, sem reescrever).
4. `DiscordService.send(destino: 'mplus', payload)`.
5. Discord aceitou → **201**. Falhou → erro honesto, valores preservados na tela.
6. Se a decisão da seção 5 for persistir: a linha é gravada **antes** da entrega, com o
   resultado da entrega marcado depois. Gravar depois perde exatamente o caso que a persistência
   existe para cobrir.

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
- Bot do Discord, slash command, leitura do Discord. A entrega é webhook, mão única. Se o
  registro cair (seção 5), aí o bot volta à mesa como **substituto** da tela, não como adição.
- Qualquer relação com rank de guilda, roster do WoWAudit ou o time de raid.

---

## 11. Ordem sugerida

Passos pequenos, cada um verde sozinho.

1. **Decidir a seção 5.** Tudo abaixo depende, e é a única coisa que não dá para adiar.
2. Generalizar `DiscordService` para múltiplos destinos + segunda variável de ambiente (6.2),
   com teste de que os destinos não se confundem.
3. Contrato no shared (seção 7) com testes de schema. `pnpm --filter @titan/shared build`.
4. Guard de membership (6.3), com o teste da Regra 5: **sem cookie devolve 401**, e membro de
   rank acima do corte **passa** (que é o ponto).
5. Endpoint + service + módulo, com o embed e a sanitização testados (`@everyone` inerte,
   markdown escapado, truncamento).
6. Persistência, se a seção 5 for por gravar.
7. Tela.
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
