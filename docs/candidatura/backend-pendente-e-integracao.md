# Candidatura — documento SUPERSEDIDO

> **Não siga este documento.** Ele especificava a candidatura gravada no banco
> (`POST /applications` → model no Prisma → migration → painel de review), arquitetura
> **cancelada em 09/08/2026**.
>
> **Documento vigente: [`docs/specs/discord-apply-flow.md`](../specs/discord-apply-flow.md).**

O conteúdo original foi substituído em vez de apagado porque a pergunta que ele respondia —
"o backend está pronto para receber a candidatura?" — continua sendo feita, e a resposta
levantada aqui continua valendo.

## O que este documento apurou, e que segue verdadeiro

Levantamento de 09/08/2026, no commit `2365745` (idêntico à `origin/main` naquele momento),
conferido em todas as refs do repositório:

- **Nunca existiu persistência de candidatura.** `apps/api/src/applications/` não aparece em
  commit nenhum; não há `model Application` no `schema.prisma`; nenhuma das 10 migrations é
  de candidatura; não há repository, seed nem fixture.
- **Não existe painel de review.** A única superfície interna é um parágrafo de promessa em
  `apps/web/app/interno/page.tsx:186-190`.
- **O formulário do front foi conectado**: valida com `createApplicationSchema` do shared e
  envia para o endpoint público, que entrega ao Discord sem persistir.
- **`@nestjs/throttler` protege o endpoint público** por IP.
- O commit `38c1dd5` (06/08/2026) simplificou deliberadamente o schema da candidatura para
  quatro campos de texto livre.

## O que mudou

A conclusão daquele documento era "falta construir a persistência". A decisão de 09/08/2026
foi **não construir persistência nenhuma**: o formulário entrega uma mensagem num canal
privado do Discord, e nada é gravado.

Isso torna obsoletas as seções que especificavam model, migration, repository, status e
painel. A parte de integração do front sobrevive em forma revisada dentro da spec nova.

Ver também a Regra 4 do `CLAUDE.md`, onde a reversão está registrada com o custo que ela
aceita.
