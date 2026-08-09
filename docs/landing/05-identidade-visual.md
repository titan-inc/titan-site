# Identidade visual da landing — contrato consolidado

Versão 3.1 — 09/08/2026. Este documento é a fonte normativa da identidade visual implementada.

## 1. Ideia central

A identidade nasce da key art `apps/web/public/assets/curseulatek.webp` e trabalha três famílias: **ardósia é o ar**, **pedra é a matéria** e **Fel é a energia**. Ardósia fria ocupa fundo e espaço negativo; pedra oliva dessaturada dá massa a chapas, bordas, sulcos e hastes apagadas; Fel aparece somente no que está aceso.

## 2. Princípios normativos

### R1 — Ardósia é o ar. Pedra é a matéria. Fel é a energia

Fundo e espaço negativo são ardósia fria. Tudo que tem massa é pedra quente dessaturada. Só energia acesa usa Fel. A oposição térmica entre ardósia azulada e pedra oliva é obrigatória.

### R2 — Fel acende matéria. Tem orçamento, não proibição

Fel e seu halo ocupam entre 10% e 18% de qualquer viewport; abaixo disso a página parece desligada e acima disso a hierarquia morre. Halo é esperado onde energia emana de matéria: veio, fratura, brasa, aresta energizada, aura da arte ou wordmark. Permanecem proibidos: `text-shadow`; halo colorido em chapa, divisória, campo, foco ou moldura; Fel como fundo chapado de seção; halo fora da família Fel; `filter: blur()` sobre conteúdo. A aura transitória do botão sólido no hover fica limitada a 24 px.

### R3 — Fotografia e interface têm papéis diferentes

A arte dá atmosfera; a interface continua legível e funcional sem depender dela. Texto não recebe sombra: o contraste vem do scrim.

### R4 — Exceção nominal para a key art

`curseulatek.webp`, derivada exclusivamente de `curseulatek.png`, é autorizada somente na hero, sob a Blizzard Fan Content Policy: site de fã, sem fim comercial e com aviso de propriedade no footer. A exceção não cobre brasão, ícone de classe, screenshot de UI, textura ou fonte da Blizzard, nem arte da Blizzard em Open Graph, favicon ou marca.

### R5 — Forma segue função

Chapa, sulco, haste e recorte existem para hierarquia e leitura, nunca como ornamento gratuito.

### R6 — Pedra não se move. Energia se move

Animação representa energia percorrendo matéria parada. Não há parallax, cards deslizando, layout em movimento, pulso de Fel ou animação contínua da progressão.

### R7 — A letra do jogo é um elemento anômalo, e vive dentro da arte

A tipografia da key art pertence à peça, não à página. A interface não imita nem aproxima a letra do jogo: o contraste entre a arte e a tipografia sóbria da interface é deliberado e aplica a R4 com coerência.

## 3. Paleta oficial

| Token                                                   | Valor                                         | Papel           |
| ------------------------------------------------------- | --------------------------------------------- | --------------- |
| `bg` / `surface` / `deep` / `deep-lit`                  | `#111a20` / `#19242c` / `#0d151b` / `#1d5233` | ardósia e campo |
| `border`                                                | `#27343d`                                     | divisória       |
| `fg` / `fg-muted` / `fg-subtle`                         | `#e9f1dd` / `#aab29c` / `#8b9382`             | osso e texto    |
| `accent` / `accent-lit` / `accent-deep` / `accent-soft` | `#8ff04b` / `#c6ee3a` / `#2c7a18` / `#16240f` | Fel             |
| `pedra` / `pedra-lit` / `pedra-deep`                    | `#8f9a63` / `#c2cb8e` / `#39422a`             | matéria         |
| `edge` / `groove`                                       | `rgba(233,241,221,.08)` / `rgba(0,0,0,.52)`   | luz e sulco     |

Os aliases `bronze*` foram removidos integralmente. `accent-deep` nunca é texto e nunca recebe opacidade. Cores de classe continuam como exceção de dado, apenas na borda da placa e no arco do retrato.

Contraste WCAG remedido após a v3.1 (`bg` / `surface`): `fg` 15,17:1 / 13,60:1; `fg-muted` 8,01:1 / 7,19:1; `fg-subtle` 5,53:1 / 4,96:1. Todos os pares aprovam AA, inclusive o par crítico `fg-subtle` sobre `surface`.

## 4. Tipografia

Archivo é a única face de títulos e corpo; h1 e h2 usam extrabold e tracking `-0.02em`. Geist Mono permanece em rótulos, metadados, navegação, botões e numerais. Não existe face de display na interface.

O gradiente vertical Fel (`accent-lit` → `accent` → `accent-deep`) aparece somente no `INC` do wordmark e em no máximo uma ênfase por h2. A h1 é osso. Em forced colors a letra volta a `CanvasText`.

## 5. Marca

`TITANINC` usa Archivo extrabold, `fontStretch: 112%` e os tamanhos históricos 18/22/34 px. `TITAN` mantém `currentColor`; `INC` usa o gradiente Fel e faz uma única ignição no carregamento. O `aria-label="Titan Inc"` é obrigatório.

## 6. Hero

A grade de 12 colunas é preservada: texto ocupa colunas 1–5 e a key art decorativa ocupa 7–12. No mobile, arte vem antes do texto. A imagem usa `next/image`, `preload`, dimensões 1202×802, `object-contain`, alpha com múltiplos valores e arquivo WebP de 149.584 bytes. Dois gradientes formam a aura atrás da peça e um horizonte Fel assenta a base da hero; a imagem não usa blend mode nem filtro.

O fundo não usa imagem: ardósia, fenda Fel radial, três estratos de pedra, malha entalhada, quatro veios, 14 brasas determinísticas, scrim direcional e vinheta são CSS. `hero-background.png` não existe. A coluna textual mantém piso escuro e não usa `text-shadow`.

## 7. Progressão

A régua de hastes, resumo, limite de 20 bosses e `sr-only` permanecem. Hastes acesas recebem apenas uma cascata de ignição no carregamento; nunca há animação contínua.

Raid e dificuldade aparecem como **sigla**, nunca como nome inteiro: `CM · M`, na forma em que jogador escreve progressão. O nome completo truncava em "Complexo Merid…", que não informa nada e parece defeito — a régua vive entre o wordmark e o menu e não tem largura para mais que isso. Com sigla o rótulo cabe a partir do `lg`, sem truncamento.

O nome completo não se perde e nunca pode se perder: fica no `title`, no painel do mobile e na descrição do leitor de tela. A derivação e o mapa de exceções vivem em `lib/progressao/sigla.ts`.

## 8. Roster

A fonte pública é `apps/web/content/roster.json`, validada com Zod em `lib/roster/conteudo.ts`. A lista versionada é provisória, usa dez nomes fictícios e deve ser substituída no JSON junto das fotos em `public/roster`; ao fazê-lo, remove-se o sufixo “· lista de exemplo”. Campos: `nome` obrigatório (1–24), `imagem` e `classe` opcionais. O `prebuild` enumera fotos em um manifesto importado pelo servidor, sem acesso ao filesystem em request e compatível com standalone. Fotos são locais, lazy e têm dimensões explícitas. Arquivo ausente cai no retrato editorial; JSON inválido quebra o build; lista vazia omite a seção.

## 9. Candidatura

Hero e candidatura compartilham a gramática do campo Fel. Veios são o único movimento contínuo e representam carga passando em fraturas. Formulário, schema, honeypot e relações ARIA permanecem intactos.

## 10. Movimento e acessibilidade

Veios têm 52 px, opacidade 0,45–0,72 e brilho corrente a 0,85 em 5–9 s. Brasas medem 4–9 px, usam opacidade 0,22–0,5 e halo próprio de 12 px. Estratos usam opacidade 0,6 e pedra clara/escura; a malha usa 0,34. Fenda, arte, wordmark e hastes têm ignição única. H2 usa carve-in com `animation-timeline: view()` exclusivamente dentro de `@supports`. Sem suporte, headings ficam visíveis. Em hover capaz, ação sólida ganha aura ≤24 px, ação fantasma acende borda, haste da nav cresce e placa do roster sobe 2 px com borda de classe de 3 px. `prefers-reduced-motion` desliga todo movimento e esconde brasas, mantendo fenda, aura, arte e conteúdo visíveis. Só `transform`, `opacity` e `clip-path` animam; não há `will-change` permanente. Um único overlay fixo de grão SVG cobre a página.

## 11. Área interna

A área interna herda tokens e Archivo extrabold nos títulos de página. Não recebe campo Fel, veios, brasas, carve-in ou animação em laço.

## 12. Iconografia, Open Graph e proibições

Não criar ornamento que imite UI do WoW. A arte licenciada não entra em OG, favicon ou marca. Open Graph serializa os RGB da paleta nova. São proibidos: `text-shadow`, glow permanente de interface, Fel acima de 18% do viewport, imitação tipográfica do letreiro do jogo, aleatoriedade em Server Component e qualquer informação transmitida só por cor ou movimento.

## 13. Governança

Este arquivo e `04-implementation-spec.md` são os únicos contratos vivos da landing. Mudança implementada deve editar estes contratos diretamente; não criar documento paralelo de emenda.
