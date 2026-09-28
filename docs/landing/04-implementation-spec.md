# Landing pública — especificação de implementação

Versão 3.1 — 09/08/2026. `apps/api` permanece fora do escopo da landing, com uma exceção nominal já implementada: o controller de autenticação pode escolher o destino final do OAuth. Essa exceção não autoriza mudar sessão, membership, rank, guards, services, Prisma ou migrations.

## 1. Objetivo e arquitetura

A landing afere: expõe existência, agenda, progressão, time curado e candidatura. Next renderiza e consome API; negócio e banco permanecem no Nest. Layout, grade de 12 colunas, máximos 1120/1440 px, ritmo vertical, ordem das seções e trilho mobile são preservados.

## 2. Identidade

Tokens, tipografia, marca, movimento e regras de imagem obedecem integralmente a `05-identidade-visual.md`. Archivo e Geist Mono são as únicas faces; não existe fonte de display. A hero usa `/assets/curseulatek.webp`, com alpha real, sobre fundo CSS e nenhuma imagem de fundo. A arte é decorativa, preloaded e ≤220 KB.

## 3. Progressão pública

`layout.tsx` resume o relatório com `resumirProgressaoNav`. A régua mantém limite de 20 bosses, numerais tabulares, fallback `—/—` e descrição `sr-only`. Só a ignição inicial das hastes acesas é permitida.

Raid e dificuldade são exibidas por sigla (`lib/progressao/sigla.ts`), derivada das iniciais das palavras significativas, com teto de 4 caracteres e mapa de exceções para siglas consagradas. Nome completo permanece no `title`, no painel do mobile e no `sr-only`.

**A fonte hoje é mock de desenvolvimento, não o backend.** `lib/progressao/fonte.ts` devolve `PROGRESSAO_MOCK_PARCIAL` em dev e `null` em produção: a API só expõe raid progress em `internal/raid-progress`, atrás do `MemberGuard`, e não existe endpoint público. Por isso o nome da raid, os bosses e as datas são fictícios e **não refletem a progressão real** — trocar o texto exibido é editar `lib/mock/progressao.mock.ts`. Quando o endpoint público existir, o único arquivo que muda é `fonte.ts`; nem o layout nem a hero sabem de onde o dado vem.

## 4. Roster público

`content/roster.json` é a única fonte. A lista versionada atual contém dez nomes fictícios de exemplo e o cabeçalho a declara como tal; ela é substituída editando esse JSON e subindo as fotos em `public/roster/`. Quem trocar os nomes remove “· lista de exemplo” no mesmo commit. `lib/roster/conteudo.ts` valida título, descrição e membros com Zod durante leitura no Server Component. O `prebuild` gera `imagens-geradas.ts` a partir de `public/roster`, portanto não há `existsSync` em request nem dependência do layout standalone. JSON inválido quebra build; imagem inexistente vira `RetratoEditorial`; `membros: []` não renderiza a seção. Não há `RosterEntry`, API, mock de dados da landing, score ou item level.

## 5. Login

O caminho principal é o link “Acesse com a Battle.net”. **Desde a TIT-148 (01/09/2026) ele é um `<a>` para `${API_URL}/auth/battlenet`, em navegação de página inteira** — não há mais popup, `postMessage`, `BroadcastChannel` nem polling, e por isso não há mais fallback separado: o caminho principal já funciona sem JavaScript. Falha, cancelamento e `state` inválido voltam em `/?erro=…` e abrem o mesmo `<dialog>` acessível. O anúncio `aria-live` do botão saiu junto com o popup — não há mais estado assíncrono para narrar, e a navegação em si já é o feedback.

No Nest, `auth.controller.ts` grava `titan_oauth_destino` quando `?de=` aponta para dentro de `/interno`, com as mesmas flags e TTL do cookie de state, e o callback devolve ali. `titan_oauth_mode` não existe mais. State, `completeLogin`, `me()` e `logout()` permanecem inalterados; sessão, TTL e logs mudaram pela TIT-148, fora do escopo da landing.

## 6. Seções e área interna

Sobre, roster e candidatura usam Archivo extrabold, uma única ênfase Fel e carve-in progressivo com fallback visível. A candidatura preserva formulário e validação. A área interna recebe apenas paleta nos títulos de página; não recebe efeitos atmosféricos ou animação contínua.

## 7. Responsividade e acessibilidade

Em 320 px a arte precede a h1 e não há overflow. Em `lg` a hero volta à grade 5+6. Imagens têm dimensões e `sizes`; foco é visível; modal devolve foco ao botão e fecha com Escape; forced colors mantém texto; movimento reduzido deixa tudo estático e visível; navegadores sem scroll timeline recebem headings normais.

## 8. Orçamento

| Item | Teto |
| --- | --- |
| arte da hero | 220 KB (alvo ≤180 KB) |
| fontes adicionais | 0 KB de display; preload principal Archivo 90.096 bytes; teto 95 KB |
| CSS | 20 KB gzip |
| JS da rota `/` | 45 KB gzip |
| LCP em 4G | <2,0 s |
| CLS | <0,02 |

Não usar `filter` repetido, `will-change` permanente, `Math.random()` em Server Component ou animação de layout.

## 9. Registro consolidado

- v3.0 (09/08/2026): identidade Curse of Ula'tek, três famílias cromáticas, Grenze Gotisch, hero CSS + WebP, movimento material, roster estático validado e login em popup com destino direto (o popup saiu na TIT-148, 01/09/2026).
- v3.1 (09/08/2026): Archivo restaurada em títulos e marca; roster ganha dez placeholders honestamente rotulados e manifesto de imagens gerado no build; Fel, pedra e movimento ganham presença; arte passa a WebP com alpha, aura e horizonte.
- v2.x: identidade Fel anterior e primeira implementação da landing.
