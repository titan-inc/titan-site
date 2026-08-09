# Landing pública — contrato de implementação vigente

> Fonte única de verdade da implementação da landing da Titan Inc.
>
> Estado consolidado em 06/08/2026. Este documento substitui as especificações incrementais anteriores sobre hero fotográfica, progressão na navbar e candidatura Fel. Ele descreve o que existe no código; decisões futuras devem alterar este arquivo e o código no mesmo commit.

## 1. Objetivo e tese

A landing apresenta a Titan Inc como uma guilda de endgame compatível com vida adulta e conduz o visitante até uma candidatura curta.

A tese é: **a landing afere**. Ela evita promessas vagas e expõe sinais verificáveis — tempo de existência, agenda, progressão, roster e fontes externas. A interface usa o vocabulário de registro, leitura e aferição, sem transformar o site em painel administrativo.

## 2. Escopo atual

A rota `/` contém, nesta ordem:

1. navbar fixa;
2. hero;
3. sobre;
4. tripulação;
5. candidatura;
6. footer.

As rotas `/entrar`, `/oauth/callback` e `/interno/*` não usam o shell da landing. Autenticação, membership e dados de negócio continuam regidos pelo `CLAUDE.md`: Next renderiza e consome; Nest autoriza, acessa banco e integra APIs externas.

## 3. Arquitetura relevante

```text
apps/web/app/
├─ layout.tsx                         # fontes, sessão e resumo da progressão
├─ page.tsx                           # ordem das seções
├─ globals.css                        # tokens, superfícies e fundo Fel da candidatura
├─ opengraph-image.tsx                # card social alinhado à identidade vigente
└─ _components/
   ├─ site-shell.tsx                  # aplica nav/main/footer apenas em `/`
   ├─ site-nav.tsx                    # navegação, seção ativa e disclosure móvel
   ├─ nav-painel.tsx                  # painel móvel com progressão e links
   ├─ nav/progressao-nav.tsx          # leitura compacta da progressão
   ├─ hero.tsx                        # hero fotográfica
   ├─ sobre.tsx                       # fatos e texto institucional
   ├─ roster/                         # grade/trilho e placas da tripulação
   └─ apply/                          # candidatura e validação local

apps/web/lib/
├─ progressao/                        # seleção e resumo do relatório de raid
├─ wow/classe.ts                      # cores oficiais de classe, só apresentação
└─ mock/                              # dados de desenvolvimento

packages/shared/src/application.ts    # schema único da candidatura
```

Não reintroduzir o antigo instrumento circular, o campo profundo, a logo raster ou a imagem de recrutamento. Esses caminhos foram substituídos e seus componentes foram removidos.

## 4. Dados e estados

### 4.1 Sessão

`layout.tsx` obtém a sessão com `getSessionUser()`. Falhas são tratadas pela camada de API existente. A navbar apresenta login, usuário ou fallback de autenticação conforme `LoginButton`.

### 4.2 Progressão pública

`resumirProgressaoNav()` recebe `RaidProgressReport | null` e produz um DTO serializável com:

- nome da raid;
- nome da dificuldade;
- bosses vencidos e total;
- um booleano por boss;
- marca de dados de desenvolvimento.

A dificuldade escolhida é a maior com kill; sem kills, usa-se a maior disponível. A raid escolhida prioriza mais kills, depois a kill mais recente e, por fim, a ordem original. Relatórios sem dificuldade, raid válida, nome ou bosses degradam para `null`.

No estado atual, dados de desenvolvimento são carregados apenas fora de produção. Em produção, até a integração pública ser ligada, a navbar mostra estado indisponível e não inventa números.

### 4.3 Roster

O roster público usa mock apenas em desenvolvimento. Em produção, enquanto a fonte não estiver ligada, a seção apresenta um estado indisponível explícito.

As placas aceitam retrato remoto. Sem retrato, `RetratoEditorial` gera fallback determinístico a partir de `realm/name`. A cor de classe aparece somente na borda esquerda e no arco do fallback; ela nunca colore texto.

### 4.4 Candidatura

O contrato compartilhado é:

| Campo | Obrigatório | Limite |
| --- | --- | ---: |
| `characterRealm` | sim | 2–80 |
| `roleSpec` | sim | 2–80 |
| `contact` | sim | 2–100 |
| `additionalInfo` | não | 0–2000 |
| `website` | não, honeypot | deve permanecer vazio |

O formulário usa o mesmo `createApplicationSchema` no blur e no submit. Erros são associados ao campo, resumidos em `role="alert"` e o primeiro campo inválido recebe foco no envio.

O envio permanece deliberadamente desabilitado. A interface informa que nenhum dado foi enviado. Não criar request fictícia, persistência local ou mensagem de sucesso antes do endpoint real.

## 5. Navbar

### Desktop (`lg:+`)

- altura: 64 px em `lg`, 60 px em `md` e 56 px abaixo disso;
- wordmark alinhado verticalmente e com `line-height: 1`;
- progressão fica entre marca e links;
- em `xl`, exibe raid e dificuldade; em larguras menores preserva marcas e contagem;
- seção ativa é indicada por uma haste inferior, não apenas por cor;
- após 24 px de scroll, a barra recebe a superfície `chapa`.

### Mobile

- a progressão completa vive no painel;
- a partir de 390 px, a contagem curta também aparece na barra;
- o botão informa seção ativa e descrição da progressão no nome acessível;
- o painel fecha por Escape, clique externo e navegação, devolvendo foco ao gatilho;
- sem JavaScript, progressão e links continuam disponíveis no bloco `noscript`.

## 6. Hero

A hero usa `public/assets/hero-background.png` por meio de `next/image` com `fill`, `preload` e `sizes="100vw"`.

- enquadramento base: `object-position: 72% 50%`;
- enquadramento em `lg:+`: `65% 50%`;
- scrim horizontal protege a coluna de texto;
- gradiente inferior reduz conflito na base;
- a imagem é decorativa (`alt=""`);
- a hero ocupa aproximadamente a primeira viewport, descontando a navbar, com teto de 900 px em desktop.

O conteúdo é sempre a prioridade: rótulo, H1, parágrafo e CTA ficam no DOM acima da fotografia. Não usar sombra em texto para compensar contraste; ajustar o scrim.

## 7. Sobre

A seção apresenta três fatos de leitura rápida — desde 2009, ritmo de cinco horas por semana e agenda — junto do texto institucional.

O texto longo ainda contém placeholder marcado em código. A substituição por copy aprovada é pendência editorial, não licença para inventar história da guilda.

## 8. Tripulação

No mobile, a lista é um trilho horizontal com snap e placas de largura controlada. A partir de `md`, torna-se grade com até três, quatro e cinco colunas nos breakpoints sucessivos. A última fileira não estica placas além do limite visual.

As placas mostram retrato, nome, realm, função, especialização, item level e score quando disponíveis. Ausência de dado usa travessão ou fallback explícito; zero e ausência não são equivalentes.

## 9. Candidatura e fundo Fel

A seção não possui imagem de personagem. O fundo é totalmente CSS:

- base em carvão esverdeado e superfície mineral;
- duas zonas radiais de baixa intensidade;
- grade estrutural inclinada;
- cinco veios Fel poligonais, assimétricos e sem glow;
- opacidade reduzida e extensão ampliada no mobile.

O formulário fica em uma `chapa` opaca o suficiente para garantir leitura. Em desktop ele ocupa as seis colunas da direita; em mobile ocupa a largura disponível. Os veios são decorativos, ficam fora da árvore acessível e não recebem interação.

## 10. Responsividade

| Faixa | Comportamento principal |
| --- | --- |
| `<390 px` | navbar mínima; contagem curta oculta; formulário em uma coluna |
| `390–767 px` | contagem curta visível; roster em trilho; veios Fel atravessam a seção |
| `768–1023 px` | espaçamento intermediário; roster em grade de até três colunas |
| `1024–1279 px` | navbar completa; hero em 12 colunas; roster até quatro colunas |
| `≥1280 px` | metadado da progressão visível; roster até cinco colunas; largura máxima de 1120/1440 px |

Requisitos permanentes:

- sem rolagem horizontal da página entre 320 e 2560 px;
- alvos interativos com mínimo de 44 px;
- texto refluindo a 200% de zoom;
- orientação paisagem móvel tratada pela regra específica da hero;
- nenhum conteúdo essencial dependente de hover.

## 11. Acessibilidade

- `html` usa `lang="pt-BR"`;
- existe skip link para `#conteudo`;
- cada seção tem heading associado por `aria-labelledby`;
- imagens atmosféricas e retratos redundantes usam alt vazio;
- foco global usa Fel com contraste e offset;
- `prefers-reduced-motion` reduz animações e transições;
- `prefers-contrast: more` reforça foco e bordas;
- estado não depende apenas de cor: progressão inclui contagem, seção ativa inclui haste e erro inclui texto;
- o painel móvel preserva foco e teclado;
- o formulário mantém ajuda e erro em `aria-describedby`.

## 12. Performance

Regras vigentes:

- a fotografia da hero é o único asset visual grande e é otimizada pelo `next/image`;
- somente a hero recebe preload;
- retratos do roster usam lazy loading;
- candidatura, wordmark, progressão e OG não dependem de novas imagens;
- fontes usam `next/font`; Archivo faz swap e Geist Mono não é preloaded;
- nenhuma biblioteca de animação ou formulário é necessária;
- mock de progressão e roster é importado dinamicamente somente em desenvolvimento;
- componentes decorativos aposentados não permanecem no bundle ou no código sem uso.

## 13. Conteúdo e pendências reais

Pendências que não devem ser mascaradas:

- copy institucional da seção Sobre;
- endpoint de envio da candidatura;
- fonte pública de progressão em produção;
- fonte pública do roster em produção;
- URL oficial do Discord;
- decisão final de deploy.

Até essas integrações existirem, a UI deve dizer “indisponível”, “pendente” ou “envio fechado”. Nunca preencher com dados plausíveis em produção.

## 14. Critérios de aceite

Uma alteração da landing só está concluída quando:

1. preserva a ordem e a hierarquia semântica das seções;
2. respeita o contrato visual do documento `05-identidade-visual.md`;
3. não reintroduz assets e componentes aposentados;
4. funciona com teclado e motion reduzido;
5. mantém estados nulo, parcial, completo e indisponível sem inventar dado;
6. passa por `pnpm format:check`, `pnpm build`, `pnpm lint`, `pnpm typecheck` e `pnpm test`;
7. é conferida em 320, 390, 768, 1024, 1280 e 1440 px quando houver navegador de QA disponível.

## 15. Registro consolidado

- A logo raster e a metáfora náutica foram removidas.
- O wordmark tipográfico tornou-se a marca principal.
- A paleta migrou para Fel controlado, carvão e ferro-oliva.
- A hero passou a usar fotografia Fel com scrim direcional.
- O instrumento circular de progressão foi removido; a leitura passou à navbar.
- O formulário foi reduzido aos campos necessários para iniciar uma conversa.
- A imagem de recrutamento foi removida; a seção passou a usar veios Fel em CSS.
- As especificações incrementais 06, 07 e 08 foram absorvidas neste contrato e deixaram de existir como fontes concorrentes.
