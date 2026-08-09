# Identidade visual — contrato vigente

> Documento normativo da identidade da Titan Inc no site.
>
> Estado consolidado em 06/08/2026. Este arquivo substitui `05-identidade-titanica.md` e as emendas visuais que estavam distribuídas nos documentos 06, 07 e 08.

## 1. Ideia central

A Titan Inc não é apresentada como fantasia naval, painel sci-fi ou reprodução literal da interface de World of Warcraft. O site constrói um ambiente próprio: **estrutura mineral antiga atravessada por energia Fel controlada**.

O tom visual deve comunicar peso, disciplina e aferição. A energia aparece como sinal de funcionamento, nunca como decoração espalhada.

## 2. Princípios normativos

### R1 — Ferro-oliva é estrutura; Fel é energia

Fundos, chapas, linhas, sulcos e ornamentos usam carvão, superfície esverdeada e ferro-oliva dessaturado. Fel fica reservado para:

- ações primárias;
- foco;
- progresso vencido;
- `INC` no wordmark;
- fraturas energizadas da candidatura.

### R2 — Fel é sinal, não preenchimento

Não usar Fel como fundo de seção, grande mancha, texto corrido ou borda generalizada. Não usar glow, blur luminoso, neon ou sombra colorida. A energia deve ter aresta definida.

### R3 — Fotografia e interface têm papéis diferentes

A fotografia da hero estabelece atmosfera. A interface estabelece hierarquia e precisão. Não sobrepor mecanismos detalhados ou decoração competitiva à imagem. O scrim faz a ponte entre fotografia e conteúdo.

### R4 — O site não imita a UI do jogo

São proibidos molduras de addon, barras de vida, tooltip de item, textura de pergaminho, runas copiadas, brasões oficiais e qualquer asset proprietário usado como ornamento. Referências a World of Warcraft aparecem no conteúdo e nos dados, não por imitação de interface.

### R5 — Forma segue função

Toda marca visual precisa explicar um papel: chapa agrupa, sulco separa, haste marca estado, Fel indica energia ou ação, monoespaçada identifica metadado. Ornamento sem função deve ser removido.

## 3. Paleta oficial

| Token                 | Valor                   | Uso                        |
| --------------------- | ----------------------- | -------------------------- |
| `--color-bg`          | `#080b08`               | fundo principal            |
| `--color-surface`     | `#111611`               | superfícies elevadas       |
| `--color-border`      | `#293329`               | divisórias e contornos     |
| `--color-fg`          | `#edf2e8`               | texto principal            |
| `--color-fg-muted`    | `#a5aea0`               | texto secundário           |
| `--color-fg-subtle`   | `#838d7e`               | metadado pequeno           |
| `--color-accent`      | `#8eea45`               | energia Fel e ação         |
| `--color-accent-soft` | `#193311`               | apoio Fel de pequena área  |
| `--color-bronze`      | `#87945f`               | ferro-oliva estrutural     |
| `--color-bronze-lit`  | `#b4c27c`               | aresta mineral iluminada   |
| `--color-bronze-deep` | `#3d472f`               | sulco, estrutura apagada   |
| `--color-edge`        | `rgba(237,242,232,.08)` | luz superior de chapa      |
| `--color-groove`      | `rgba(0,0,0,.52)`       | sulco inferior             |
| `--color-deep`        | `#0b100c`               | campo atmosférico          |
| `--color-deep-lit`    | `#19331c`               | núcleo de gradiente        |
| `--color-ok`          | `#63d18b`               | sucesso, mais frio que Fel |
| `--color-danger`      | `#ff8178`               | erro e falha               |
| `--color-danger-soft` | `#351b19`               | fundo de erro              |

Os nomes `bronze*` permanecem por compatibilidade, mas sua leitura visual é ferro-oliva, não ouro ou bronze polido.

Nenhuma página pode hardcodar uma cor de identidade. Alterações de paleta acontecem nos tokens de `globals.css`.

## 4. Exceção: cores de classe do WoW

A única exceção autorizada ao uso exclusivo de tokens são as treze cores oficiais de classe, centralizadas em `apps/web/lib/wow/classe.ts`.

Regras:

- são dado de apresentação, não contrato compartilhado;
- entram por `style` apenas na borda esquerda da placa e no arco do retrato editorial;
- nunca aparecem como cor de texto;
- nunca preenchem áreas grandes;
- grafia desconhecida degrada para `--color-fg-subtle`;
- nenhum outro hex inline é permitido fora desse módulo e de APIs que exigem estilo serializado, como `ImageResponse`.

## 5. Tipografia

### Archivo

Fonte sans principal, carregada com eixo de largura. Usa-se em títulos, texto corrido, botões e wordmark.

- títulos: peso 700–800, tracking levemente negativo;
- corpo: 17–22 px conforme contexto, line-height aproximado de 1.6;
- não usar caixa alta em parágrafos ou headings longos.

### Geist Mono

Fonte de metadado: rótulos, contagens, estados, navegação e pequenas leituras técnicas.

- tamanho recorrente: 10–11 px;
- caixa alta;
- tracking entre `.12em` e `.14em`;
- nunca usar em texto corrido.

## 6. Marca

A marca principal é o wordmark tipográfico `TITANINC`:

- `TITAN` usa a cor do contexto;
- `INC` usa Fel;
- não existe espaço visual amplo entre as partes;
- usa Archivo extrabold, largura 112%, tracking `-0.02em` e `line-height: 1`;
- precisa permanecer alinhado ao centro da navbar.

A antiga imagem `titan-inc-logo.png` está aposentada e não deve voltar. A âncora, aquarela e gradiente azul/roxo/rosa não fazem parte da identidade vigente.

`Marca` no footer é um vestígio abstrato de baixa opacidade, sem função de progressão. Ela pode ser substituída ou removida, mas nunca promovida a marca principal.

## 7. Superfícies e geometria

### Chapa

`chapa` é a superfície elevada padrão:

- raio de 3 px;
- aresta superior clara;
- sulco inferior escuro;
- gradiente vertical quase imperceptível;
- sem sombra colorida;
- sombra preta é permitida apenas para separação espacial, como no formulário sobre o campo Fel.

### Linhas e hastes

Linhas estruturais têm 1 px. Estado ativo pode usar uma haste Fel mais longa. Cantos arredondados grandes e cartões flutuantes genéricos não pertencem à landing.

### Espaçamento

Conteúdo principal respeita largura máxima de 1120 px; a composição da hero pode chegar a 1440 px. Seções usam ritmo vertical amplo, tipicamente 96–160 px conforme breakpoint.

## 8. Fotografia da hero

`public/assets/hero-background.png` é a única fotografia atmosférica obrigatória da landing.

Direção:

- escura, Fel e com assunto deslocado para a direita;
- preserva área negativa para a manchete à esquerda;
- recebe scrim horizontal escuro e gradiente inferior;
- não recebe filtro de blur, glow ou saturação agressiva;
- não carrega texto embutido;
- é decorativa no HTML.

O enquadramento é parte do contrato: 72% no mobile/base e 65% em desktop. Mudanças exigem conferir a face/assunto e a legibilidade do H1 em todos os breakpoints.

## 9. Progressão na navbar

A progressão é uma régua compacta, não um instrumento circular.

- boss vencido: haste Fel de 2 px e 12 px de altura;
- boss pendente: haste de ferro-oliva de 1 px e 6 px;
- linha de base: sulco estrutural;
- contagem `vencidos/total`: texto principal monoespaçado;
- raid e dificuldade: metadado secundário, visível apenas quando há espaço;
- acima de 20 bosses, as marcas individuais somem e a contagem permanece.

É proibido tornar as hastes interativas, adicionar tooltip, animar progressão ou reconstruir o disco aposentado.

## 10. Roster

A placa da tripulação é editorial, não um card de jogo:

- retrato ocupa a maior parte da área;
- dados ficam em faixa inferior compacta;
- cor de classe é uma assinatura lateral estreita;
- fallback de retrato usa tipografia e um arco, sem simular personagem;
- nomes e valores permanecem em cores neutras para garantir contraste.

## 11. Candidatura Fel

A candidatura representa uma superfície de registro diante de um campo instável, mas controlado.

O fundo atual é CSS, sem imagem:

- gradiente mineral de carvão para superfície;
- campos radiais Fel de até 8% de mistura;
- grade inclinada em opacidade baixa;
- cinco fraturas poligonais com rotações e espessuras distintas;
- nenhuma animação, glow ou blur;
- no mobile, os veios ficam mais largos e menos opacos.

O formulário permanece em uma chapa escura à direita no desktop e em largura total no mobile. Veios não podem atravessar visualmente o texto a ponto de reduzir contraste.

## 12. Movimento

O estado vigente não depende de animação ornamental. Transições curtas são permitidas para foco, hover, navbar rolada e abertura do painel.

Regras:

- duração curta e easing simples para UI;
- nenhuma animação contínua;
- nenhuma pulsação Fel;
- nenhuma paralaxe;
- `prefers-reduced-motion: reduce` deve reduzir tudo a efeito praticamente instantâneo;
- movimento nunca comunica informação sozinho.

## 13. Iconografia e imagens

- preferir tipografia, linha, CSS e componentes existentes;
- não criar SVG ilustrativo novo para substituir uma imagem;
- ícones, quando necessários, devem ser simples e funcionais;
- não usar imagem de recrutamento, personagem ou armadura como fundo da candidatura;
- retratos reais do roster são permitidos quando vêm da fonte de dados;
- toda imagem grande precisa passar pelo `next/image`, salvo geração do Open Graph.

## 14. Open Graph

O card social reproduz o sistema atual: fundo carvão/Fel, wordmark tipográfico, headline e régua de progressão indisponível. Não usa logo raster, disco ou imagem de recrutamento.

Como `ImageResponse` recebe estilos serializados, cores equivalentes aos tokens podem aparecer como valores RGB nesse arquivo. Elas devem ser atualizadas junto com a paleta.

## 15. Voz e conteúdo

Tom:

- direto e adulto;
- específico sobre tempo, agenda e fontes;
- sem grandiosidade vazia;
- sem jargão naval;
- sem fingir que dado pendente está disponível;
- português brasileiro, com termos do jogo apenas quando são a forma natural usada pela comunidade.

Exemplos alinhados: “cinco horas por semana”, “dados de desenvolvimento”, “progressão indisponível”, “deixe o essencial”.

## 16. Proibições resumidas

Não usar:

- logo raster antiga;
- metáfora náutica ou âncora;
- paleta azul/roxo/rosa anterior;
- ouro brilhante;
- neon, glow ou blur luminoso;
- instrumento circular de progressão;
- imagem de orc/recrutamento;
- estética de addon ou UI copiada do WoW;
- Fel em grandes preenchimentos;
- cor de classe como texto;
- sombras de texto;
- decoração animada contínua.

## 17. Governança

Este documento legisla a identidade vigente. `04-implementation-spec.md` legisla estrutura, comportamento, estados e QA. `globals.css` é a implementação canônica dos tokens.

Se código e documento divergirem, a alteração não está concluída: decidir qual estado é intencional e atualizar ambos no mesmo commit. Não criar novo documento de emenda; editar estes contratos diretamente e registrar a decisão no histórico do Git.
