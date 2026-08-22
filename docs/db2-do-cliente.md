# Dados do cliente do WoW (db2): extração, análise e o que já foi medido

Como o site descobre o que uma peça de loot **realmente é** — item level, track,
socket, terciário e os valores de stat que o jogo mostra.

Serve à TIT-82 (dicionário de bonus IDs) e à TIT-136 (cálculo de stats), e é
pré-requisito do popover de item da TIT-135.

## Por que isto existe

Um `itemString` traz `bonusIds` e nada mais:

```
item:249967::240900::::::90:250::35:4:6652:13440:12806:13534::::::
```

Sem tradução, o conselho vota sem saber no que está votando. E o problema é
concreto, não teórico: **duas peças com o mesmo `itemID` podem ser coisas bem
diferentes** — foi por isso que a Regra 7 mandou guardar o `itemString` cru e
inteiro.

Só que traduzir esses números é mais difícil do que parece:

> **Não existe tabela "stats deste item".** Os valores não são guardados em
> lugar nenhum — são calculados, por uma fórmula espalhada por várias tabelas
> do cliente.

Reproduzir isso é **reimplementar o escalonamento de itens do jogo**. Vale
dizer com todas as letras, porque muda como o trabalho deve ser conduzido.

## De onde vem o dado, e por que não das outras duas opções

**A Blizzard não serve.** Não existe endpoint da Game Data API que liste bonus
IDs: o `/data/wow/item/{id}` não suporta bonus list nem creation context, e é
lacuna reconhecida há anos. Ele devolve o **item base**, que é justamente o que
não distingue duas peças do mesmo `itemID`.

**O Wowhead renderizaria o item perfeito de graça**, e foi descartado: seria
dependência de terceiro **no browser**, atritando com a Regra 6, e a sessão ao
vivo passaria a depender de o Wowhead estar de pé no meio da raid. Além disso
tooltip não dá o que o explorador precisa — filtrar e agregar por modificador.

**Sobra o cliente.** Os `.db2` são as tabelas de dados do próprio WoW. Duas
formas de obtê-los:

| forma                            | quando                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| [wago.tools](https://wago.tools) | não exige o jogo instalado; escolhe o build                             |
| **`wow.export`**                 | extrai direto da instalação local — é o build que a guilda está jogando |

Usamos o `wow.export`. Sai em SQL ou CSV.

### Duas abas diferentes: `Data` e `Text`

Os `.db2` ficam na aba **`Data`**. Mas parte do que a fórmula precisa **não é
db2**: são **GameTables**, arquivos de texto separado por tab, e ficam na aba
**`Text`**.

São eles: `CombatRatingsMultByILvl`, `StaminaMultByILvl` e
`ItemSocketCostPerLevel`. Procurar por esses nomes na aba `Data` não encontra
nada — foi exatamente o que aconteceu na primeira tentativa.

Formato: uma linha por item level, com cabeçalho.

```
Item Level	Armor Multiplier	Weapon Multiplier	Trinket Multiplier	Jewelry Multiplier
1	1.5	1.5	1.5	1.5
```

## A fonte que encurta tudo: o SimulationCraft

O [simc](https://github.com/simulationcraft/simc) implementa este cálculo há
anos, validado contra o jogo inteiro em vez de contra um punhado de peças.

Dois lugares valem mais que qualquer medição nossa:

| onde                          | o quê                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `engine/dbc/sc_item_data.cpp` | `random_suffix_type` (índice por slot), `scaled_stat` (a fórmula inteira), `item_combat_rating_type` (qual multiplicador) |
| `casc_extract/dbfile`         | **a lista literal** de db2 e GameTables que eles extraem do cliente                                                       |

O `dbfile` é o jeito certo de descobrir o nome e o **tipo** de um arquivo — foi
ele que revelou que os três multiplicadores são GameTables e não db2.

**Consultar o SimC antes de medir**, não depois. Medir serve para confirmar que
entendemos o que copiamos — quando a ordem se inverteu, nesta pesquisa, o
resultado foi seis afirmações erradas que fechavam contra peças reais (ver "O
erro que se cancelava").

## Regra que vale para os dois lados

**A app nunca fala com o wago.tools nem lê `.db2`.** O arquivo é obtido à mão,
convertido à mão, e entra por rota de ops — mesma separação do `catalog-load`.

Some a chamada externa, some rate limit, e some o dia em que a fonte muda de
formato e um job nosso quebra em produção.

## Quais tabelas, e o que cada uma responde

### A lista de extração: 41 arquivos

Isto é a checklist do `wow.export`, a cada patch. Abaixo dela, o que cada tabela
responde e por que está aqui.

```
RESOLUÇÃO DE BÔNUS (6)
  ItemSparse   Item   ItemBonus
  ItemXBonusTree   ItemBonusTreeNode   ItemBonusTree*

ITEM LEVEL (5)
  ItemScalingConfig   ItemOffsetCurve   CurvePoint
  ItemLevelSelector*   ItemLevelSelectorQuality*

OS NÚMEROS (12)
  RandPropPoints
  CombatRatingsMultByILvl†   StaminaMultByILvl†   ItemSocketCostPerLevel†
  ItemArmorTotal   ItemArmorQuality   ArmorLocation   ItemArmorShield
  ItemDamageOneHand   ItemDamageTwoHand
  ItemDamageOneHandCaster   ItemDamageTwoHandCaster

EFEITO (7)
  ItemXItemEffect   ItemEffect   Spell   SpellEffect
  SpellMisc   SpellDuration   SpellAuraOptions

TEXTO (11)
  ItemNameDescription
  ItemBonusListGroup   ItemBonusListGroupEntry   SharedString
  ItemSet   ItemSetSpell   ChrSpecialization
  GlobalStrings   ChrClasses   ItemClass   ItemSubClass

  †  GameTable — aba Text do wow.export, não a Data
  *  hoje sem uso; ver "Mantidas apesar de não usadas"
```

**Dez tabelas saíram desta lista em 20/08/2026** — ver "Deixaram de ser
extraídas". Se você está com 51 arquivos, está com a lista velha.

### As palavras de busca: 4 no total

O filtro do `wow.export` é substring simples no nome do recurso, e **Data e Text
são buscas separadas**. Estas quatro alcançam os 41 arquivos:

| aba      | busque  | pega                                                                                                                           |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Data** | `Item`  | 26 dos 38                                                                                                                      |
| **Data** | `Spell` | mais 6                                                                                                                         |
| **Data** | `r`     | os 7 que sobram: `CurvePoint` `RandPropPoints` `ArmorLocation` `SharedString` `GlobalStrings` `ChrSpecialization` `ChrClasses` |
| **Text** | `l`     | as 3 GameTables                                                                                                                |

A busca traz muito mais do que você precisa, e tudo bem — a lista acima é a
checklist do que selecionar.

#### Por que não dá para fazer menos

O mínimo teórico é **3** (`e` + `o` na Data, `l` na Text), provado por busca
exaustiva sobre todos os substrings dos 41 nomes. **Uma busca só na Data é
impossível:** `Item` e `Spell` não compartilham nenhuma letra além do `e`, e o
`e` não alcança `RandPropPoints`, `ArmorLocation` nem `GlobalStrings` — que só se
juntam pelo `o`.

Mas `e` casa com quase toda tabela do jogo, e o ganho de uma busca não paga a
lista inteira na tela. Daí o `Item`/`Spell`/`r`.

#### E se você preferir listas curtas

Com palavras de 3+ letras **não existe solução com menos de 6** na Data —
verificado exaustivamente, 4 e 5 são impossíveis:

```
Data:  Item   Spe   Armor   Point   String   Class
Text:  MultByILvl   ItemSocket
```

`Spe` em vez de `Spell` porque pega `ChrSpecialization` junto.

> **Duas suposições sobre o app, não verificadas:** que o filtro aceita busca de
> um caractere, e que ele é case-insensitive.
>
> Se exigir **2+ caracteres**, o mínimo na Data passa de 3 para **5** — também
> verificado exaustivamente, 4 é impossível:
>
> ```
> Data:  Item   Spell   in   ar   Chr
> Text:  MultByILvl   ItemSocket
> ```
>
> (`in` pega `CurvePoint`, `RandPropPoints` e `GlobalStrings`; `ar` pega
> `ArmorLocation` e `SharedString`.)
>
> Na Text a busca de um caractere é a **única** forma de fazer uma só: as três
> GameTables não têm nenhum par de letras em comum. Com 2+ caracteres são sempre
> duas buscas.

### Essenciais

| tabela                  | responde                                                                           | tamanho |
| ----------------------- | ---------------------------------------------------------------------------------- | ------- |
| `ItemSparse`            | ilvl base, qualidade, `InventoryType`, **quais stats** e a **alocação** de cada um | ~59 MB  |
| `RandPropPoints`        | o **orçamento** de pontos de stat para cada item level                             | pequena |
| `ItemBonus`             | o que cada bonus id modifica                                                       | média   |
| **`ItemXBonusTree`**    | item → árvore de bônus                                                             | média   |
| **`ItemBonusTreeNode`** | os nós da árvore, filtrados por `ItemContext`                                      | pequena |

> As duas últimas são **obrigatórias**, e isso só ficou claro no vigésimo
> espécime: o `itemString` não é a fonte completa. Ver "O `itemString` NÃO é a
> fonte completa" adiante.

### Para resolver o item level

| tabela                    | papel                                                     |
| ------------------------- | --------------------------------------------------------- |
| `ItemScalingConfig`       | `ItemLevel`, `ItemOffsetCurveID`, `ItemSquishEraID`       |
| `ItemOffsetCurve`         | `CurveID` + `Offset` — o par que transforma o valor acima |
| `CurvePoint`              | os pontos da curva, interpolados                          |
| `ContentTuning`           | teto de nível em alguns caminhos                          |
| `ItemBonusListLevelDelta` | lista de bonus → delta de ilvl (caminho antigo)           |

### Para armadura e dano de arma

| tabela                                      | papel                                                             |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `ItemArmorTotal`                            | armadura base por ilvl, uma coluna por material                   |
| `ItemArmorQuality`                          | modificador por qualidade                                         |
| `ArmorLocation`                             | modificador por slot — **use as 4 colunas de material, não a 5ª** |
| `ItemArmorShield`                           | escudo, tabela separada                                           |
| `ItemDamageOneHand` / `TwoHand` / `*Caster` | dps por ilvl e qualidade                                          |

### Para o track de upgrade

| tabela                    | papel                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| `ItemBonusListGroupEntry` | `SequenceValue` (o rank) e o `Flags` — o total são as entradas `!= 3`  |
| **`SharedString`**        | **o nome da track**, apontado pelo 2º valor do `Type 34`               |
| `ItemBonusListGroup`      | o grupo. O `ItemGroupIlvlScalingID` distingue season atual da anterior |
| `GlobalStrings`           | o formato `ITEM_UPGRADE_TOOLTIP_FORMAT_STRING` — útil de referência    |

### Para o descritor de dificuldade ("Mythic", "Mythic+", "Heroic")

| tabela                | papel                                            |
| --------------------- | ------------------------------------------------ |
| `ItemNameDescription` | o texto e a cor, apontado pelo `Type 4` do bônus |

### Para o texto de efeito (trinket, "Use:", "Equip:")

| tabela                        | papel                                                                 |
| ----------------------------- | --------------------------------------------------------------------- |
| `ItemXItemEffect`             | liga item → efeito. **O `ItemEffect` sozinho não tem coluna de item** |
| `ItemEffect`                  | `SpellID`, `TriggerType`, cooldown                                    |
| `Spell`                       | `Description_lang` — o texto, com placeholders                        |
| `SpellEffect`                 | `Coefficient`, `ScalingClass` — de onde saem os números               |
| `SpellMisc` + `SpellDuration` | o `$d` (duração)                                                      |
| `SpellAuraOptions`            | o `$u` (`CumulativeAura`, máximo de stacks)                           |

### Para item que NÃO é equipamento

| tabela         | papel                                                              |
| -------------- | ------------------------------------------------------------------ |
| `ChrClasses`   | nome da classe, para a linha `Classes: …`                          |
| `ItemClass`    | nome da classe de item (`Housing`, `Miscellaneous`)                |
| `ItemSubClass` | nome da subclasse — é o que o tooltip mostra (`Decor`, `Cosmetic`) |

### Para item de set

| tabela              | papel                                       |
| ------------------- | ------------------------------------------- |
| `ItemSet`           | nome do set e os `ItemID` das peças         |
| `ItemSetSpell`      | os bônus, por `ChrSpecID` e por `Threshold` |
| `ChrSpecialization` | nome da spec, `ClassID` e `OrderIndex`      |

### Também obrigatórias, e fáceis de esquecer

| tabela          | papel                                                                 |
| --------------- | --------------------------------------------------------------------- |
| `Item`          | `ClassID` e `SubclassID` — entram no `idx` de orçamento e na armadura |
| `GlobalStrings` | **toda frase que o tooltip mostra e não está no dado do item**        |
| `SpellName`     | nome do spell, útil para conferir o que se está lendo                 |

O `GlobalStrings` deixou de ser "útil de referência" e virou dependência: o modo
sem personagem, o `Binds to Warband`, o `Use:` do cosmético e a linha
`Classes: %s` saem todos dele.

### Mantidas apesar de não usadas — e o motivo é o tamanho, não a esperança

Três tabelas ficam na lista de extração sem estarem no caminho de renderização
nenhum. Somam **0,11 MB**, então cortá-las não paga o risco de virarem lacuna:

| tabela                                           | por que fica                                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `ItemLevelSelector` + `ItemLevelSelectorQuality` | `ChildItemLevelSelectorID` é não-zero em **2.234 nós** da árvore. Nenhum item nosso passou por lá — ainda         |
| `ItemBonusTree`                                  | a travessia usa só o `ItemBonusTreeNode`, mas ela tem `InventoryTypeSlotMask` não-zero em **422 de 4.785** linhas |

**Isto é exatamente o formato da árvore de bônus**: alcançável, nunca alcançada,
e invisível se estiver errado. A diferença é que agora está escrito.

### Deixaram de ser extraídas (20/08/2026)

Dez tabelas saíram da lista, cada uma com o motivo medido — para ninguém
reextrair "por via das dúvidas" no próximo patch:

| tabela                                                                               | por que sai                                                                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `SpellName` (12,7 MB)                                                                | `Spell` não tem `Name_lang`, mas **nenhuma linha de tooltip mostra nome de spell**. É apoio de análise |
| `SpellDescriptionVariables`                                                          | **inalcançável por construção** — o link é `Spell.DescriptionVariablesID`, coluna que nem é extraída   |
| `ItemBonusListLevelDelta`                                                            | redundante: as 3 listas nossas que estão nela trazem o mesmo delta pelo `Type 1`                       |
| `ExpectedStat`                                                                       | indexada por **nível de personagem**, não por item level — eixo errado                                 |
| `SpellScaling`, `ContentTuning`                                                      | nada no caminho aponta para elas                                                                       |
| `ItemSubClassMask`                                                                   | a máscara de classe dos tokens sai do `AllowableClass`, não daqui                                      |
| `ItemBonusSequenceSpell`, `ItemBonusSeasonBonusListGroup`, `ItemBonusTreeGroupEntry` | sem referência a partir de nada que usamos                                                             |

> **O corte vale por quantidade, não por tamanho.** As dez somam 13,3 MB de
> 282 MB — 4,7%, irrelevante. O que elas custam é **um export manual cada, a cada
> patch**: sair de 51 para 41 arquivos é ~20% menos passos no `wow.export`.
>
> E o volume nunca foi problema do lado da app: medido com 61 itens, o filtro do
> caminho de ops devolve 61 linhas de `ItemSparse`, 22 de `SpellEffect` e 15 de
> `SpellMisc`. **Os 282 MB são custo de extração, não de carga.**

## O tamanho não é obstáculo, desde que o filtro seja o certo

O `ItemSparse` bruto tem ~59 MB, contra o teto de 2mb do `/internal/ops`.

**Filtrar pelos `itemId` que temos no catálogo**, e não por expansão:

- por "expansão atual + equipamento" ainda seriam milhares de linhas, e
  **cortaria o histórico** — o catálogo vai até Dragonflight S1 (TIT-124), e a
  tabela de histórico é consumidora do popover
- pelos nossos ids são **algumas centenas de linhas**, cobrindo o histórico
  inteiro e cabendo com folga nos 2mb

E, dentro disso, **cortar coluna antes de cortar linha**: o `ItemSparse` tem 68
colunas e a fórmula usa ~13.

Medido com os 61 itens dos espécimes, o filtro devolve isto:

| tabela        | linhas cheias | filtradas | por item |
| ------------- | ------------: | --------: | -------: |
| `ItemSparse`  |       175.174 |    **61** |      1,0 |
| `Item`        |       213.345 |    **61** |      1,0 |
| `SpellEffect` |       629.143 |    **22** |      0,4 |
| `SpellMisc`   |       417.506 |    **15** |      0,2 |
| `Spell`       |       413.913 |    **15** |      0,2 |

Cerca de uma linha por item, e menos de meia linha de spell por item.

### Mas o filtro de spell precisa do FECHO, não só dos spells do item

O texto de efeito **referencia outros spells por id**, e o cliente resolve essas
referências na hora de montar o tooltip:

```
$@spelldesc1305830   → a descrição inteira do spell 1305830
$1291885s1           → o valor do efeito 1 do spell 1291885
$1295582d            → a duração do spell 1295582
```

Filtrar `Spell`, `SpellEffect` e `SpellMisc` por "os spells que os nossos itens
apontam" **não basta**: os ids citados no texto precisam entrar junto, e depois
os ids citados _neles_, até fechar.

Medido na amostra: **15 spells diretos viram 20**, fator `1,33x`, e cinco deles
nenhum item nosso aponta. O fecho é raso — parou na profundidade 1 — mas não é
vazio, e sem ele o tooltip mostra `$@spelldesc1305830` literalmente na tela.

## Como analisar: banco local, descartável

Extrair como **SQL** e subir num SQLite local. A análise é cruzar `ItemSparse`
com `RandPropPoints` e `ItemBonus` — isso é junção, e junção é o que SQL faz
bem. Em CSV vira script descartável a cada pergunta.

Carga completa leva segundos (`ItemSparse` com 175 mil linhas em ~2s):

```python
"""Carrega os dumps do wow.export num SQLite local, para análise."""
import sqlite3, sys, time
from pathlib import Path

ORIGEM = Path("localdocs/wow.export")
DESTINO = ORIGEM / "wow.db"

con = sqlite3.connect(DESTINO)
con.execute("PRAGMA journal_mode = OFF")   # análise local: velocidade > durabilidade
con.execute("PRAGMA synchronous = OFF")

for nome in sys.argv[1:] or sorted(p.name for p in ORIGEM.glob("*.sql")):
    arquivo = ORIGEM / nome
    inicio = time.time()
    con.executescript(arquivo.read_text(encoding="utf-8"))
    con.commit()
    (linhas,) = con.execute(f'SELECT count(*) FROM "{arquivo.stem}"').fetchone()
    print(f"{arquivo.stem:32} {linhas:>9,} linhas  {time.time() - inicio:5.1f}s")
```

O dialeto do `wow.export` (crases do MySQL) o SQLite aceita sem ajuste.

### Três cuidados

**O banco de análise é separado e descartável.** Nada disso encosta no Postgres
da app: o `schema.prisma` nunca referencia essas tabelas, e a app nunca abre
conexão com esse banco. A fronteira é o arquivo tratado.

**Nada disso entra no git.** O repositório é público, o `ItemSparse` sozinho tem
dezenas de MB, e dado extraído do cliente num repo aberto é confusão
desnecessária. O que vira commit é só o resultado: schema, fórmula e fixtures.

> `localdocs/` está no `.gitignore` versionado, então a proteção vale para quem
> clonar. Até 16/08/2026 estava só em `.git/info/exclude`, que protege **uma
> máquina** — e este documento manda colocar dezenas de MB ali, então a
> proteção precisava deixar de ser pessoal.

**A query de extração é o artefato que sobrevive.** É ela que torna verdadeira a
promessa de que "a atualização a cada patch é um comando, não uma tarde": novo
patch → extrai de novo → roda a mesma query → sai o arquivo novo.

## Sempre anote o build

```
/run print(GetBuildInfo())
```

A análise abaixo é do build **12.1.0 69299 (Aug 12 2026)**.

Sem isso, uma divergência de número daqui a dois meses é indistinguível entre
bug nosso e mudança de patch — e essa é a dúvida que mais custa tempo.

## A ordem em que as coisas se resolvem

Este documento cresceu por rodadas de investigação, e por isso as seções estão na
ordem em que as coisas foram **descobertas**, não na ordem em que precisam ser
**executadas**. Quem for implementar segue esta lista; as seções detalham cada
passo.

```
1. RESOLVER OS BÔNUS   ← faça isto antes de qualquer conta
   a) os bonus IDs do itemString
   b) MAIS os nós da árvore com ItemContext igual ao do item
   c) expandindo todo Type 50 (APPLY_BONUS), que aponta para outra lista
   união dos três, como conjunto

2. ITEM LEVEL          Type 49 → ItemScalingConfig → curva + offset

3. OS NÚMEROS          orçamento por ilvl e slot, multiplicadores,
                       armadura, dano de arma, efeito

4. O TEXTO             descritor, track, set, vínculo, flavor
                       e o que só existe no GlobalStrings
```

> **Os dois primeiros passos são onde mora o perigo.** Os dois canais de bônus
> fora do `itemString` — a **árvore** e o **`Type 50`** — falham do mesmo jeito
> quando ignorados: o item renderiza com o valor base, **sem erro nenhum**. Foram
> os dois últimos achados da pesquisa, e os dois estavam invisíveis por meses.
>
> Ver "O `itemString` NÃO é a fonte completa" e "O `Type 50` aponta para OUTRA
> lista".

Nada abaixo vale se o passo 1 estiver incompleto.

## A fórmula

**Reproduz 73 de 73 valores de stat da fixture**, sem nenhuma constante ajustada
à mão.

```
idx     = random_suffix_type( itemClass, itemSubclass, inventoryType )
budget  = RandPropPoints[ilvl].EpicF[idx]        ← a coluna FLOAT, não a INT
penalty = round_banqueiro( StatPercentageOfSocket[i] × ItemSocketCostPerLevel[ilvl] )

cru = StatPercentEditor[i] × budget × 0,0001 − penalty

se combat rating:  cru ×= CombatRatingsMultByILvl[ilvl][tipo]
senão se stamina:  cru ×= StaminaMultByILvl[ilvl][tipo]

valor = round( cru )
```

**Primário não recebe multiplicador nenhum** — não é combat rating.

### `idx` — a classe de orçamento, por classe e slot

| item                                            | idx   |
| ----------------------------------------------- | ----- |
| arma de duas mãos (e arco, arma de fogo, besta) | **0** |
| cabeça, peito, pernas, robe                     | **0** |
| ombro, cintura, pés, mãos, **trinket**          | **1** |
| **pescoço, dedo, capa, pulso**                  | **2** |
| arma de uma mão, offhand, item de mão, escudo   | **3** |

### `tipo` — o multiplicador, por slot

| slot             | coluna  |
| ---------------- | ------- |
| pescoço, dedo    | Jewelry |
| trinket          | Trinket |
| qualquer arma    | Weapon  |
| resto (armadura) | Armor   |

### A coluna é a FLOAT — e isto corrige uma afirmação em negrito

`EpicF`, não `Epic`. As duas colunas existem lado a lado no `RandPropPoints`, e a
INT é a truncagem da outra: no ilvl 276, `208` contra `208,86428833`.

Menos de um ponto de orçamento, e é o bastante para atravessar o arredondamento.
Medido contra a fixture inteira, mesmo conferidor, mudando só a coluna:

| coluna do orçamento | valores de stat que fecham |
| ------------------- | -------------------------- |
| `Epic` (INT)        | 38 de 73                   |
| **`EpicF` (float)** | **73 de 73**               |

### Duas coisas menores, ambas confirmadas

|                |                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| arredondamento | **`round`**, nunca truncamento                                                                                                                                                                                |
| qualidade      | **irrelevante na prática** — `EpicF` = `SuperiorF` = `GoodF` em **1300 de 1300** linhas. O SimC escolhe a coluna por qualidade (épico/lendário → `p_epic`, raro → `p_rare`), e neste build as três são iguais |

> **Esta seção substitui duas versões erradas.**
>
> A primeira afirmava que quatro slots diferentes usavam todos o índice 1, que o
> primário mudava de regra por categoria, e que stamina tinha uma constante
> 7,402. Ver "O erro que se cancelava" adiante.
>
> A segunda afirmava, em negrito, `Epic` **(INT), nunca** `EpicF`. Ver "A coluna
> INT: o erro que a própria fixture já denunciava" adiante.

### O `Type` do `ItemBonus` — o enum do SimC, que NÃO é o enum do jogo

Boa parte não precisa ser decodificada à mão: está nomeada no
`engine/dbc/data_enums.hh` do SimC, em `enum item_bonus_type`.

> **Uma versão anterior chamava esta tabela de "o enum completo". Não é.** Ela é
> o enum completo **do SimC**, e o jogo usa mais do que isso: uma única noite de
> raid trouxe nove `Type` que ele não nomeia — `0, 7, 9, 16, 26, 34, 37, 46, 47`
> —, e **dois deles decidem coisas que renderizamos** (o `34` é a track, o `46` é
> o vínculo). Ver "Consultar outro projeto funciona" no fim do documento.
>
> A palavra "completo" importava porque era ela que autorizava arquivar um `Type`
> desconhecido como ruído.

| Type | nome                    | Type | nome                      |
| ---- | ----------------------- | ---- | ------------------------- |
| 1    | `ILEVEL`                | 25   | `MOD_ITEM_STAT`           |
| 2    | `MOD` (acrescenta stat) | 36   | `ILEVEL_IN_PVP`           |
| 3    | `QUALITY`               | 42   | `SET_ILEVEL_2`            |
| 4    | **`DESC`**              | 48   | `SQUISH_CURVE`            |
| 5    | `SUFFIX`                | 49   | **`SCALE_CONFIG`**        |
| 6    | `SOCKET`                | 50   | **`APPLY_BONUS`**         |
| 8    | `REQ_LEVEL`             | 51   | `SCALE_CONFIG_2`          |
| 11   | `SCALING`               | 52   | `CRAFTING_QUALITY`        |
| 13   | `SCALING_2`             | 53   | `POST_SQUISH_ITEM_LEVEL`  |
| 14   | `SET_ILEVEL`            | 17   | `ADD_RANK`                |
| 23   | `ADD_ITEM_EFFECT`       | 38   | _(sem nome — ver abaixo)_ |

Os quatro que tinham sido decodificados à mão (1, 2, 3, 6) estão certos. E há um
comentário no fonte que confirma uma medição nossa: **`QUALITY` "seems unused as
of Midnight"** — coerente com `Epic` = `Superior` = `Good` em 1300 de 1300
linhas do `RandPropPoints`.

O `Type 2` **valida cruzado** os ids de stat terciário: bonus 40 → `63,3000`;
41 → `62,3000`; 42 → `61,3000`; 43 → `64,3000`, ou seja **63=Avoidance,
62=Leech, 61=Speed, 64=Indestructible**.

#### Os que o SimC não nomeia, e o que sabemos deles

Todos observados em drop real. **Nenhum foi decodificado a partir do nome** — o
que está aqui é medição ou ausência dela, explicitamente.

| Type | listas no build | o que sabemos                                                                |
| ---- | --------------- | ---------------------------------------------------------------------------- |
| 0    | muitas          | **no-op** — lista marcadora, sem efeito em número nenhum                     |
| 34   | —               | **a track**: `(ItemBonusListGroupID, SharedString.ID)`. Achado nosso         |
| 46   | **4**           | **vínculo**: `1` → `Warbound until equipped`. Medido, ver a seção do vínculo |
| 7    | 1.136           | aparece junto das listas de track. Não decodificado                          |
| 9    | 532             | anda com socket e terciário; presente em loot Normal soulbound               |
| 16   | 292             | não decodificado                                                             |
| 26   | 31              | acompanha terciário e socket. Não decodificado                               |
| 37   | 42              | não decodificado                                                             |
| 47   | 24              | independente do `46` — existe sozinho em 3 listas. Não decodificado          |

Os seis sem decodificação são **perguntas abertas**, pela regra deste documento,
e não detalhes. O que autoriza renderizar sem eles hoje é que nenhum deles
apareceu alterando um valor que a fixture confere — e isso é um argumento fraco,
do mesmo formato do que já falhou uma vez com o `Type 50`.

#### O `Type 38` não está no enum, e é seguro ignorar

Ele aparece em **53 listas, e todas contêm exclusivamente `Type 38`** — nenhuma
carrega ilvl, stat, qualidade ou qualquer outra coisa. Vêm em **grupos de cinco**,
um grupo por geração de tier (10 gerações), mais três listas soltas com `17`.

Cruzando um grupo com o set correspondente, o padrão fecha:

| peça          | `InventoryType` | lista | `Type 38`   |
| ------------- | --------------- | ----- | ----------- |
| Intake        | 1 (Head)        | 13338 | `1` + `18`  |
| Exhaustplates | 3 (Shoulder)    | 13340 | `3` + `19`  |
| Engine        | 5 (Chest)       | 13336 | `5` + `20`  |
| Pistons       | 7 (Legs)        | 13339 | `7` + `22`  |
| Essence Grips | 10 (Hands)      | 13337 | `10` + `21` |

**O primeiro valor é o `InventoryType` da peça** — que já lemos do `ItemSparse`.
O segundo é um enum paralelo de cinco valores (18–22), numa ordem diferente
(Head, Shoulder, Chest, **Hands**, Legs), e esse não foi identificado.

Provavelmente marcação de tier/Catalyst, **e isso é palpite** — fica escrito como
palpite. O que é medição: aparece só em peça de tier, não toca stat, ilvl,
qualidade nem efeito, e **o que ele diz de slot nós já sabemos por outro
caminho**. Não pode mudar nenhum número de tooltip.

> Isto não contradiz a regra "campo não decodificado é pergunta aberta". A
> pergunta foi feita e respondida o suficiente para decidir: **o campo é
> redundante para o que renderizamos.** O que a regra proíbe é arquivar sem
> perguntar.

### O item level dos itens modernos

`Type 49` (`SCALE_CONFIG`) é a resposta, e o caminho é:

```
ItemScalingConfig[ valor_do_bonus ]
  → ItemOffsetCurve[ ItemOffsetCurveID ]  →  { CurveID, Offset }

ilvl = round( curve_point_value( CurveID, ItemScalingConfig.ItemLevel ) ) + Offset
```

Verificado em seis configs, todas exatas: 82, 276, 289, 292, 295, 298.

#### O `Type 50` (`APPLY_BONUS`) aponta para OUTRA lista — a resolução é recursiva

Uma lista de bônus pode não conter o `SCALE_CONFIG` ela mesma: ela contém um
`Type 50`, cujo valor é **o id de outra lista de bônus**, que precisa ser expandida
no lugar.

```
bônus 9330 → Type 50 → lista 13478 → Type 49 (SCALE_CONFIG) = 7
```

**Quem lê só o primeiro nível vê um item incompleto — sem erro, com números
plausíveis.** É o formato de engano que este documento já registrou três vezes,
e a implementação precisa acertá-lo de saída: expandir `Type 50` antes de
interpretar qualquer coisa.

Nos espécimes analisados a curva é a **identidade** — `CurveID` 88583 tem dois
pontos, `(0,0)` e `(1300,1300)`, e `Offset` 0 —, então o `ItemScalingConfig.ItemLevel`
já é o valor final. **Isso não autoriza pular a curva:** outras entradas do
`ItemOffsetCurve` têm offsets de −6 a +6, e a transformação existe para ser
aplicada.

> Uma versão anterior deste documento afirmava que o `Type 49` "não é o item
> level" porque os valores 310 e 311 diferiam de 1 enquanto o ilvl exibido
> diferia de 3, e porque esses ids não existiam no `ItemLevelSelector`. Estava
> certo sobre o `ItemLevelSelector` e **errado sobre o resto**: 310 e 311 são
> ids de `ItemScalingConfig`, e as linhas de lá trazem `ItemLevel` 292 e 295.

#### Dois casos mais, achados pela auto-conferência da TIT-139

Nenhum dos 19 espécimes anteriores exercitava estes dois caminhos — fecharam
sem eles. Dois espécimes de arma de era antiga (`Ancient Amani Greataxe`,
`Tarnished Dawnlit Greatsword`/`Beacon`) obrigaram a fórmula a crescer.

**Duas listas do MESMO `itemString` podem carregar `Type 49`, e só uma
vale.** O `Ancient Amani Greataxe` tem `13844` (`Value "449,1,0,0"`, config
449 → ilvl **256**) e `13845` (`Value "450,0,0,0"`, config 450 → ilvl **263**,
o que o tooltip mostra). O segundo elemento do `Value` distingue as duas: `0`
é a config que vale, `1` não. Uma fixture só não prova regra geral — fica
registrado como o que a evidência sustenta, não como o enum inteiro do campo.

**`Type 51` (`SCALE_CONFIG_2`) é canal alternativo ao `Type 49`, mesma tabela
de config — e `ItemScalingConfig.ItemLevel = 0` muda o eixo da curva.** O par
`Tarnished Dawnlit` carrega `Type 51` (`Value "481,1,0,0"`, config 481) com
`ItemLevel = 0`. Não é "sem ilvl": é sinal de que a curva apontada
(`ItemOffsetCurveID 66` → `CurveID 109495`) não é indexada por item level —
seus `Pos` são **níveis de personagem** (70, 83, 84, 86, 87, 89, 90, 100), com
plateau em `(90, 253)`. E 253 é exatamente o ilvl que o tooltip mostra.

Como o popover renderiza sem personagem (ver "O jogo já tem um modo sem
personagem"), o nível usado no eixo é o **nível de personagem máximo (90)**,
não o nível do `itemString` de quem coletou o espécime (81, porque o
personagem que linkou não estava no cap). Verificado: `curve_point_value(109495,
90) = 253`, batendo exato nos dois itens do par.

`Type 51` não está no enum do SimC (eles não olham era antiga do jeito que
isto olha) nem tinha aparecido nos 19 espécimes anteriores — todos pós-squish,
todos com `Type 49` só, `ItemLevel` sempre não-zero.

### O descritor de dificuldade

`Type 4` (`DESC`) aponta para o `ItemNameDescription`, que traz o texto e a cor:

| id    | texto       | conferido contra |
| ----- | ----------- | ---------------- |
| 14095 | **Mythic+** | cinto e anel     |
| 13145 | **Mythic**  | colares, trinket |
| 2015  | **Heroic**  | machado          |

Três de três.

### O custo de socket, e a distinção que o `itemString` não faz

`StatPercentageOfSocket` é **por stat**, não-zero em **12.260 itens** — os que
**nascem** com socket. O desconto é

```
penalty = round_banqueiro( StatPercentageOfSocket[i] × ItemSocketCostPerLevel[ilvl] )
```

subtraído **antes** dos multiplicadores.

Socket **nativo** custa orçamento; socket **adicionado** por consumível não
custa. Os dois viram bonus `Type 6` idêntico (`1,7,0,0`), então **o `itemString`
sozinho não distingue** — quem distingue é o `StatPercentageOfSocket` do item
base, que é zero para quem não nasce com socket.

> Uma versão anterior afirmava que o socket custava "3 pontos de orçamento",
> medidos comparando um anel com um cinto. **Era artefato**: o anel é índice 2
> com multiplicador de joia, e eu o estava calculando no índice 1 sem
> multiplicador.

#### O `penalty` é termo morto, e procurar espécime foi descartado

Nos **20 espécimes** o penalty é zero, e isso não é amostra pequena. Medindo o
build inteiro:

```
StatPercentageOfSocket não-zero:  12.260 de 175.174 itens
   por ExpansionID:  4 (6.563) · 2 (2.813) · 3 (2.794) · 0, 1 e 5 (84)
   maior ItemLevel entre eles:  60
```

**O maior item level que paga penalty no jogo inteiro é 60.** Custo de orçamento
por socket é mecânica pré-Legion.

Socket moderno existe — 141 itens de `ExpansionID` 6 e 101 de 7 têm `SocketType`
— e entra por bônus `Type 6`, **de graça**.

> **Decisão (18/08/2026): não procurar espécime com socket nativo.** Ele existiria
> só em item de Warlords ou anterior, que a guilda não loota. O termo continua no
> código porque veio do SimC e custa uma multiplicação — mas fica registrado que
> **nenhuma fixture nossa vai exercitá-lo**, para ninguém depois ler "penalty
> sempre zero" como sinal de bug.

### O texto de efeito: template, e nenhum valor guardado

A cadeia é `ItemXItemEffect` → `ItemEffect` → `Spell`, e o texto vem com
placeholders:

```
"Bind with the blaze for $d, giving your attacks a high chance to increase
 your Strength by $s1, stacking up to $u times. ... dealing up to $s2 Fire
 damage ..."
```

**Não existe valor base para exibir.** No trinket analisado o
`SpellEffect.EffectBasePointsF` é **zero** nos dois efeitos; o que está guardado
é `Coefficient` — `0,4333` e `309,69`. Mostrar esses números seria pior que
omiti-los: o segundo tem cara de dano e não é dano.

Cada placeholder resolve assim:

| placeholder  | de onde                                                                   |
| ------------ | ------------------------------------------------------------------------- |
| `$d`         | `SpellMisc.DurationIndex` → `SpellDuration.Duration` (20000ms = "20 sec") |
| `$u`         | `SpellAuraOptions.CumulativeAura` (6)                                     |
| `$s1`, `$s2` | `Coefficient` × escala(`ScalingClass`, item level)                        |

### O `ScalingClass` decide de qual coluna sai a escala

Do `spelleffect_data_t::average( const item_t* )` do SimC:

```
valor = Coefficient × escala( ScalingClass, itemLevel )

  −7                       → EpicF[0] × CombatRatingsMultByILvl
  −8                       → RandPropPoints.DamageReplaceStat?
  0 (PLAYER_NONE) e −9     → RandPropPoints.DamageSecondary?
  resto (−1 a −6, −10)     → RandPropPoints.EpicF[0]
```

> **O `EpicF` está medido; as outras duas colunas não.**
>
> Para o `EpicF` o próprio documento já tinha a prova e não a leu: a medição do
> trinket registrada adiante dá `242,44` e `249,31` — fracionários, que a coluna
> INT não produz. A prosa dizia `Epic`, a medição usava `EpicF`, e ninguém
> confrontou as duas.
>
> Para `DamageReplaceStat` e `DamageSecondary` **nenhum espécime distingue a
> float da INT**, e a diferença não é desprezível: no ilvl 305 são `284,97`
> contra `284`. Por coerência com o `EpicF` a float é a aposta — mas isso é
> aposta, e por isso está com interrogação em vez de escrito como fato. Fecha com
> um trinket de `ScalingClass −8` cujo tooltip alguém transcreva.

> **O `0` NÃO é o caso geral, e uma versão anterior deste documento dizia que
> era.** No SimC ele é `PLAYER_NONE`, e cai no mesmo ramo do `−9`:
>
> ```cpp
> else if ( scaling_class() == PLAYER_NONE || scaling_class() == PLAYER_SPECIAL_SCALE9 )
>   budget = props.damage_secondary;
> ```
>
> Isso importa porque `0` é o valor **esmagadoramente mais comum**: 619.055
> linhas do `SpellEffect`, contra 3.290 do `−1`. Nenhum espécime pegou o erro
> porque os quatro efeitos do trinket são `−1` e `−8` — a fixture não reprova o
> que ela não exercita.

#### E esse ramo é inalcançável na prática — implemente mesmo assim

Restringindo aos efeitos **ligados a itens**:

| `ScalingClass` | efeitos de item | com `Coefficient != 0` |
| -------------- | --------------- | ---------------------- |
| **0**          | **45.115**      | **2**                  |
| −1             | 1.389           | 1.386                  |
| −9             | 957             | 932                    |
| −7             | 801             | 776                    |
| −8             | 766             | 751                    |

Nas classes negativas ~99% têm coeficiente; no `0`, **dois em 45 mil**. E a razão
é estrutural: **sem `Coefficient` o caminho de escala nem é percorrido** — o
valor sai direto do `EffectBasePointsF`. `ScalingClass 0` não é um tipo de escala
que não observamos; é o marcador de **efeito que não escala com item level**, e
é por isso que ele domina a tabela.

Os dois outliers confirmam pelo lado do absurdo: uma capa de Vanilla
(`Green Dragonskin Cloak`, ilvl 29) e um consumível de Shadowlands. **Nenhum é
loot de raid.**

> **Decisão (18/08/2026): implementar o ramo conforme o SimC e registrar que ele
> é inalcançável.** Escrito porque protege dos dois erros opostos — alguém
> "simplificar" removendo o ramo por não ver teste cobrindo, e alguém abrir issue
> de coleta para um espécime que não existe.
>
> Mesmo formato do `penalty` de socket, e pela mesma razão.

**Não existe tabela geral por `ScalingClass`, e a pendência que dizia isso era
falsa.** Valor positivo seria índice de classe, escalando por nível de
personagem; neste build o campo só assume `0` e `−1` a `−10`. Não há nada
faltando para procurar.

Verificado no trinket, nos dois ranks e nos dois efeitos:

| efeito                 | cálculo  | tooltip   |
| ---------------------- | -------- | --------- |
| Strength r1 (`−1`)     | 105,044  | **105**   |
| Strength r2 (`−1`)     | 108,021  | **108**   |
| dano de fogo r1 (`−8`) | 77.365,5 | **77365** |
| dano de fogo r2 (`−8`) | 79.753,0 | **79753** |

O `DamageReplaceStat` e o `DamageSecondary` são colunas do `RandPropPoints` que
parecem "coisa de arma" e não são — o `−8` de um trinket usa a primeira.

> **Correção (TIT-139): o arredondamento é `round`, não `floor`.** A tabela
> acima mostra o cru a 1 casa, e isso escondeu a diferença — `77.365,5`
> parece pedir `floor` porque `floor` e `round` dão o mesmo 77365 quando a
> fração é `< 0,5`. O cru de verdade do rank 2 é `79.752,998`, não
> `79.753,0`: com `floor` dá 79752, e o tooltip mostra 79753. Só `round`
> fecha os dois ranks ao mesmo tempo — mesma disciplina do resto da fórmula
> ("Duas coisas menores": `round`, nunca truncamento).

**O caso `−1` também dá um jeito de LER o item level real de uma peça**:
dividindo o número do tooltip pelo `Coefficient`, sai o orçamento, e dele o
ilvl. Foi assim que se descobriu que o trinket estava em 292/295.

> **Correção de estimativa.** Uma versão anterior deste documento e da TIT-136
> tratavam efeito de trinket como o pedaço mais caro de todos. Não é: é uma
> consulta e uma multiplicação.

## Terciários, e uma regra de exibição

Terciário entra como stat comum: o bônus traz `Type 2` com alocação **3000**, e o
valor sai da mesma fórmula dos secundários.

| bônus | stat                | verificado                                      |
| ----- | ------------------- | ----------------------------------------------- |
| 40    | Avoidance (63)      | **49**, numa luva de couro no ilvl 276          |
| 41    | Leech (62)          | **71**, num elmo de placa no ilvl 289           |
| 42    | Speed (61)          | **66**, num peito de placa no ilvl 276          |
| 43    | Indestructible (64) | calcula **68**, e o tooltip mostra só a palavra |

**Os quatro estão verificados**, e os três que viram número seguem a fórmula dos
secundários sem exceção nenhuma.

> **`Indestructible` é flag na tela, mesmo tendo valor no dado.** Renderizar o
> número seria certo pelo dado e errado pela tela.

## Primário flexível: mostrar todos, porque não há personagem

O stat de primário não diz "Strength" — diz **quais primários a peça pode
assumir**, e o jogo escolhe pela spec de quem está olhando.

| stat | primários possíveis          |
| ---- | ---------------------------- |
| 71   | Strength, Agility, Intellect |
| 72   | Strength, Agility            |
| 73   | Agility, Intellect           |
| 74   | Strength, Intellect          |

O valor é **o mesmo** para qualquer um deles, então é uma linha só. Como a nossa
renderização não tem personagem, ela mostra todos:

```
+124 (Strength or Intellect)
```

### A linha apagada do tooltip não é dado separado

O jogo renderiza o primário flexível como **duas linhas**, a da spec de quem olha
em branco e a outra apagada:

```
+82 Agility
+82 Intelect        ← apagada
```

São a mesma entrada. Uma luva de `Type 73` tem **uma** alocação (5259) e nenhuma
outra entrada de primário — as duas linhas saem dela. Ler o tooltip como se
fossem dois stats produziria uma peça com Agility e Intellect ao mesmo tempo.

## Item de set

```
ItemSparse.ItemSet → ItemSet.Name_lang + ItemSet.ItemID (17 posições, zeros no fim)
                   → ItemSetSpell onde ItemSetID = set
                       agrupado por ChrSpecID, ordenado por Threshold
                       texto em Spell.Description_lang
                   → ChrSpecialization dá nome da spec, ClassID e OrderIndex
```

Verificado no `Relentless Rider's Lament` (set 1978): nome, as cinco peças, e
seis bônus — dois thresholds (2 e 4) × três specs de Death Knight.

**Os bônus são POR SPEC**, e o jogo mostra só os da spec de quem olha.

**A contagem `(4/5)` do tooltip fica de fora**: é estado de personagem. O total
vem da contagem de `ItemID` não-zero; o numerador não existe sem instância — num
inspect de outro personagem o jogo mostra `(0/5)`, contando o **espectador**.

### O nome do set não é uma das peças

O tooltip lista **seis** nomes e o set tem **cinco**:

```
Devouring Reaver's Sheathe (0/5)      ← ItemSet.Name_lang
   Engine · Essence Grips · Intake · Pistons · Exhaustplates
```

`Sheathe` não é nenhum dos cinco `ItemID`. O nome do set é escolhido pela
Blizzard e **tem cara de peça** — quem tratar a primeira linha como item mostra
seis peças num set de cinco. O `(x/y)` ao lado é o que denuncia: ele pertence ao
cabeçalho.

### O jogo já tem um modo sem personagem — e é o nosso

O popover renderiza **sem personagem**: não há spec, não há bind, não há
contagem. Isso parecia problema nosso, e não é — o cliente cai no mesmo estado
sempre que mostra um item que não é seu, e as strings estão no `GlobalStrings`:

| linha        | com personagem                 | sem                                                                                             |
| ------------ | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| vínculo      | `ITEM_SOULBOUND` → "Soulbound" | `ITEM_BIND_ON_PICKUP` → **"Binds when picked up"**                                              |
| bônus de set | os da spec de quem olha        | `ITEM_SET_BONUS_NO_VALID_SPEC` → **"Bonus effects vary based on the player's specialization."** |
| contagem     | `(4/5)`                        | `(0/5)` — conta o espectador, então fica de fora                                                |

Observado num inspect de outro personagem, que é exatamente a situação do
popover: item real, espectador sem vínculo com ele.

> **Isto reverteu a decisão da rodada anterior.** Antes: "sem personagem,
> mostramos os três conjuntos de bônus, na ordem do `OrderIndex`". O jogo não faz
> isso — imprime uma linha só. E a razão é boa: seis bônus de três specs
> empilhados soterram o que decide voto, que é **qual peça**, não o texto do
> bônus.
>
> O padrão passa a ser a linha genérica; os bônus por spec continuam mapeados
> (o `ItemSetSpell` não mudou) e ficam como conteúdo expandível.

A lição vale além do set: **quando a renderização precisa de estado que não
temos, olhar como o cliente resolve o mesmo caso**. Ele já resolveu, e a string
traduzida vem junto.

### Os números do texto de set ficam para depois

O texto tem os mesmos `$s1`/`$s2`, e mais uma forma que o on-use não tinha:

```
${$1271198s1/10}
```

— expressão que referencia **outro spell** e divide.

**A decisão da linha genérica tirou isso do caminho crítico.** O padrão de
renderização é o `ITEM_SET_BONUS_NO_VALID_SPEC`, que não tem número nenhum
dentro. As expressões só voltam a importar se um dia construirmos o expansível
por spec — ou seja, isto deixou de ser pendência de pesquisa e virou
**pré-requisito de uma feature opcional**.

E mesmo lá vale o que já estava escrito: para set, o que decide voto é _qual_
efeito, não se o dano é 8% ou 9%.

## Item que não é equipamento: token, decor, cosmético

Boa parte do que cai numa raid **não é peça**. Numa lista real de 32 drops
não-equipamento, quatro formatos:

| formato                     | qtd | `ClassID` / `SubClassID`      |
| --------------------------- | --- | ----------------------------- |
| **token de set** (`Venom*`) | 20  | 15/0 (`Miscellaneous`/`Junk`) |
| **decor de casa**           | 8   | **20/0** (`Housing`/`Decor`)  |
| **cosmético de aparência**  | 2   | 4/5 (`Armor`/`Cosmetic`)      |
| reagente e companion        | 2   | 5/2 e 15/2                    |

`ClassID 20` é **`Housing`**, novidade da 12.0, e não está em enum nenhum que
circule por aí — vem do próprio `ItemClass`.

### Eles NÃO são um modelo separado

Uma versão anterior desta seção dizia que "nada aqui usa árvore de bônus". Errado,
e os tooltips reais derrubaram na primeira conferência. **Token de set tem item
level e descritor, e os dois vêm da árvore**, exatamente como equipamento:

| token           | ctx | árvore devolve                   | tooltip                     |
| --------------- | --- | -------------------------------- | --------------------------- |
| Venomcast Relic | 3   | config 312 · lista 13333 (no-op) | ilvl **298**, sem descritor |
| Venomwoven Idol | 5   | config 315 · lista 13334         | ilvl **308**, **Heroic**    |
| Venomcured Icon | 6   | config 320 · lista 13335         | ilvl **324**, **Mythic**    |

O mesmo `itemID` aparece com `itemContext` 3, 5 ou 6 conforme a dificuldade de
onde caiu, e é só isso que muda entre eles.

> O que é verdade é mais estreito: eles não usam **orçamento de stat,
> multiplicador nem track**. A resolução de bônus é a mesma.

### O que muda é a montagem da tela

```
nome
descritor        ItemBonus Type 4  OU  ItemSparse.ItemNameDescriptionID
Item Level       da árvore; base do ItemSparse quando ela não dá nada
vínculo
Use: …           ItemXItemEffect → ItemEffect → Spell.Description_lang
Classes: …       ItemSparse.AllowableClass
"flavor"         ItemSparse.Description_lang
```

**O `Use:` vem antes do `Classes:`** — a versão anterior tinha a ordem trocada.

### A linha de tipo só aparece com `InventoryType != 0`

Os tokens são `Miscellaneous/Junk` e o `Slumbering Coil Curio` é `Context Token`,
e **nenhum dos dois exibe essas palavras**. Quem exibe é o cosmético, que tem
`InventoryType 1`:

```
Head    Cosmetic
```

Renderizar a subclasse sempre poria **`Junk`** no tooltip de um token épico.

### O descritor também mora no `ItemSparse`

O `Mural` mostra `Housing Decor` na mesma posição em que uma peça mostra
`Heroic`. Não vem de bônus: vem do `ItemSparse.ItemNameDescriptionID` = 14292,
que é uma linha do **mesmo `ItemNameDescription`** já usado pelo `Type 4`.

**São duas fontes para o mesmo campo**, e o item pode ter qualquer uma.

### `Binds to Warband` é flag, não `Bonding`

O `Mural` e o `Hex Lord's Visage` têm `Bonding = 1`, igual aos tokens — e mesmo
assim o tooltip diz outra coisa:

| item   | `Bonding` | `Flags[0]` bit 27 | tooltip                |
| ------ | --------- | ----------------- | ---------------------- |
| token  | 1         | não               | `Binds when picked up` |
| Mural  | 1         | **sim**           | **`Binds to Warband`** |
| Visage | 1         | **sim**           | **`Binds to Warband`** |

O bit 27 do primeiro elemento do `Flags` **vence o `Bonding`**, e são 13.899
itens no build. Ler só o `Bonding` erra em todos eles.

As strings estão no `GlobalStrings`: `ITEM_BIND_TO_ACCOUNT` e
`ITEM_BIND_TO_BNETACCOUNT`, as duas hoje traduzidas como `Binds to Warband`.

### E existe um terceiro estado, que vem de BÔNUS e não do item

`Warbound until equipped`: a peça transita pelo warband até alguém equipar, e aí
vira soulbound. É como cai o **bonus loot** de raid.

Isso **não pode** ser propriedade do item, e o motivo é decisivo: a mesma peça
cai soulbound no loot normal e warband-até-equipar como bonus loot. Uma coluna do
`ItemSparse` não consegue ser as duas coisas; um bônus no drop consegue.

```
Type 46 = 1   →  Warbound until equipped   (sobrescreve Bonding e o bit 27)
```

Medido em `Pyrewalker's Doublet` (`itemContext 172`), que é `Bonding = 1` com o
**bit 27 desligado** — pela regra da seção anterior o tooltip diria
`Binds when picked up`, e ele diz `Warbound until equipped`. Dos quatro bônus do
`itemString`, só o `11215` carrega algo que não seja ilvl, track ou qualidade.

Dentro do `11215` os outros dois candidatos caem por contraexemplo:

| candidato        | por que cai                                                                          |
| ---------------- | ------------------------------------------------------------------------------------ |
| `Type 9 = 6,−1`  | a lista `13695`, que tem `Type 9`, está no `itemString` de drop Normal **soulbound** |
| `Type 47 = 9,−1` | aparece **sozinha**, sem `Type 46`, nas listas `11214`, `11218` e `11311`            |
| **`Type 46`**    | sobra — e existe sem `Type 47` nas listas `12395` e `13557`                          |

Os dois são botões independentes, então não há como confundir um com o outro. O
`Type 46` existe em **4 listas no db2 inteiro**, sempre com o primeiro valor `1`.

#### A string certa é a do modo sem personagem

São **quatro** strings, em dois pares — e é a mesma dobra que o documento já
registra para soulbound:

| estado             | com dono                  | **sem dono (o nosso caso)**           |
| ------------------ | ------------------------- | ------------------------------------- |
| alma               | `Soulbound`               | `Binds when picked up`                |
| warband permanente | `Warbound`                | `Binds to Warband`                    |
| **até equipar**    | `Warbound until equipped` | **`Binds to Warband until equipped`** |

O popover renderiza sem personagem, então a linha a mostrar é
`ITEM_BIND_TO_ACCOUNT_UNTIL_EQUIP`, não `ITEM_ACCOUNTBOUND_UNTIL_EQUIP`.

#### O SimC nunca ia responder isto

O `item_bonus_type` dele não nomeia o `46` — nem o `47`, nem o `9`. Conferido nas
branches `thewarwithin` e `midnight`. E é coerente: **vínculo não muda simulação
nenhuma.** É a seção "o que ele NÃO faz não é evidência" acontecendo num caso
concreto, e o custo de ter tratado o silêncio dele como resposta seria uma linha
de texto errada em todo bonus loot.

### O `Use:` do cosmético não existe em tabela nenhuma

O `Hex Lord's Visage` exibe

```
Use: Add this appearance to your Warband collection.
```

e o `ItemXItemEffect` dele é **vazio**. A frase é do cliente:
`ITEM_COSMETIC_LEARN`, no `GlobalStrings`. A linha solta `Cosmetic`, logo abaixo
do nome, é `ITEM_COSMETIC`.

> É o mesmo padrão do modo sem personagem: **quando o tooltip mostra algo que não
> está no dado do item, a frase está no `GlobalStrings`** e o gatilho é uma
> propriedade estrutural — aqui, ser `Armor`/`Cosmetic`.

### `AllowableClass` é bitmask, e nos tokens ela É o tipo de armadura

`-1` significa "todas". Fora isso, bit `n−1` ligado quer dizer `ChrClasses[n]`:

| valor | classes                          | token         |
| ----- | -------------------------------- | ------------- |
| 35    | Warrior, Paladin, Death Knight   | `Venomforged` |
| 3592  | Rogue, Monk, Druid, Demon Hunter | `Venomcured`  |
| 4164  | Hunter, Shaman, Evoker           | `Venomcast`   |
| 400   | Priest, Mage, Warlock            | `Venomwoven`  |

Bate um a um com o nome do token, e com o tooltip real dos quatro. O formato da
linha é `ITEM_CLASSES_ALLOWED = 'Classes: %s'`.

> **Iterar sobre o `ChrClasses`, nunca sobre `1..13` fixo.** A tabela tem **15**
> linhas neste build — `Adventurer` e `Traveler` ocupam 14 e 15. Hoje nenhuma
> máscara observada usa esses bits, e é exatamente o tipo de constante que
> envelhece sem avisar.

E os nomes curtos **não estão no `GlobalStrings`**: lá o `CLASS_WARRIOR` é o
texto longo de descrição da classe. Quem tem "Warrior" é o `ChrClasses.Name_lang`.

### O que a conferência pegou

Sete tooltips reais reprovaram **cinco** afirmações da versão anterior desta
seção: que não havia árvore, que não havia item level, a ordem de `Use:` e
`Classes:`, o `Bonding` como fonte única do vínculo, e a linha de tipo sempre
visível.

A versão anterior estava marcada como "não verificado contra tooltip real", e era
esse o motivo. **Vale como argumento a favor de sempre marcar** — o texto
avisava exatamente onde ia quebrar.

Fica aberto um detalhe só: o `Mural` traz um **número 5 ao lado de um ícone**, que
é o espaço que a decoração ocupa na casa. Nenhuma tabela extraída tem esse
campo, e ele não pertence ao loot.

## O erro que se cancelava

Antes de encontrar o SimC, a fórmula tinha sido reconstruída ajustando **um item
por vez**: para cada peça, procurar qual índice de orçamento fazia os números
fecharem.

Isso produziu seis afirmações erradas, todas registradas como "medidas":

| afirmado                                   | real                                                |
| ------------------------------------------ | --------------------------------------------------- |
| dedo e pescoço → índice 1                  | índice **2**                                        |
| arma de uma mão → índice 1                 | índice **3**                                        |
| socket custa 3 pontos de orçamento         | penalty de tabela, **zero** nestas peças            |
| constante de stamina 7,402                 | multiplicador de tabela, ~12,51 no ilvl 289         |
| "primário muda de regra por categoria"     | primário **não tem** multiplicador; era só o índice |
| track de upgrade desloca o orçamento em ~3 | **não existe** — era o índice errado                |

**Nenhuma delas era chute.** Cada uma fechava contra peças reais, com números
exatos, e tinha explicação plausível.

O motivo é que **dois erros se cancelavam**: índice baixo demais e multiplicador
ausente puxavam em direções opostas. Item a item, sempre existia um índice que
"fechava" — e quando dois itens discordavam, a diferença foi atribuída a socket
e a track de upgrade, que eram as variáveis visíveis, em vez de à fórmula.

É a versão sofisticada do que este documento já pregava: **número certo por
motivo errado é indistinguível de número certo**. Sete peças não bastaram; o que
separou foi uma fonte independente.

Corolário prático: **fixture de item real detecta fórmula errada, não fórmula
certa-por-acaso.** Ela continua obrigatória, mas não é suficiente sozinha.

## A coluna INT: o erro que a própria fixture já denunciava

Este é o segundo erro da fórmula, e ele é pior que o primeiro — porque não
precisou de fonte independente nenhuma para ser pego. **Bastava rodar a fixture
contra o que estava escrito.**

O documento afirmava, em negrito:

> | coluna do orçamento | `Epic` **(INT)**, nunca `EpicF` |

com esta justificativa:

> _"com `EpicF` + truncamento, o Strength do cinto errava por 1 e o Crit
> acertava. Com `Epic` INT + `round`, os três stats fecham."_

São **duas variáveis independentes** — a coluna e o arredondamento — e a frase
testa as duas **como par**. Quatro combinações existem; duas foram
experimentadas; a vencedora entre essas duas virou regra em negrito. A
combinação certa, **`EpicF` + `round`, nunca foi testada.**

|                 | `Epic` (INT)               | `EpicF` (float)               |
| --------------- | -------------------------- | ----------------------------- |
| com truncamento | não testado                | testado, falha                |
| com `round`     | testado, **virou a regra** | **não testado — e é a certa** |

### O código estava certo; a prosa é que derivou

Os scripts de verificação de todas as rodadas anteriores consultam
`SELECT ID, EpicF FROM RandPropPoints`. **A medição sempre usou a float.** O
documento escreveu o contrário e ninguém confrontou os dois, porque os scripts
são descartáveis e a prosa é o que fica versionado.

Consequência direta: os "~103 valores reproduzidos" que este documento
anunciava eram reais — só não eram produzidos pela fórmula que ele publicava.

### Como foi pego

Um peito **Rare de ilvl 276**, na bag de um dos três, mostrado sem nenhum motivo
especial. Três dos quatro stats vieram um ponto acima do previsto:

|                 | `Epic` = 208 | `EpicF` = 208,864 | tooltip |
| --------------- | ------------ | ----------------- | ------- |
| Intellect       | 109 ✗        | **110**           | 110     |
| Stamina         | 1967 ✗       | **1975**          | 1975    |
| Critical Strike | 98 ✗         | **99**            | 99      |
| Mastery         | 55           | **55**            | 55      |

Rodando a fixture inteira, mesmo conferidor, mudando só a coluna: **`EpicF` fecha
73 de 73; `Epic` fecha 38 de 73.** Não é caso de borda — é metade da fixture.

### As duas lições, e a segunda é nova

A primeira já estava escrita e se repetiu: **os 20 espécimes anteriores eram
todos épicos**, e neles a diferença entre a INT e a float nem sempre atravessava
o arredondamento. Espécime que concorda não distingue regra que concorda nele.

A segunda não estava, e é a que importa mais:

> **Duas variáveis testadas como par exploram metade do espaço.** Quando uma
> conclusão depende de duas escolhas ao mesmo tempo, as quatro combinações
> precisam aparecer — ou a que ficou de fora é candidata a ser a certa.

E há uma terceira, sobre este documento e não sobre WoW: **prosa e verificação
precisam ser confrontadas de propósito**, porque elas derivam em silêncio. A
fixture existia, estava versionada, e reprovava o texto havia rodadas.

## Armadura

```
armadura = floor( ItemArmorTotal[ilvl][material] × ItemArmorQuality[ilvl][qual]
                  × ArmorLocation[slot][material] + 0,5 )
```

`material` vem do `Item.SubclassID` — 1 Cloth, 2 Leather, 3 Mail, 4 Plate. Item
cujo subclass é `Misc` (0) ou maior que Plate **não tem armadura innata**: o anel
devolve zero, e o tooltip dele de fato não tem a linha.

**Escudo tem tabela própria** e não passa por aqui:

```
armadura = floor( ItemArmorShield[ilvl].Quality[qual] + 0,5 )
```

Sem modificador de slot nem de material. Verificado: 766 num escudo no ilvl 250.

E aqui o SimC confirma a nossa medição **literalmente**, `+0,5` dentro do `floor`
incluso:

```cpp
if ( item.item_class == ITEM_CLASS_ARMOR && item.item_subclass == ITEM_SUBCLASS_ARMOR_SHIELD )
    return ( uint32_t ) floor( dbc.item_armor_shield( ilevel ).value( item.quality ) + 0.5 );
```

### O `Block` — fechado, e o SimC não tem

```
Block = floor( ItemArmorShield[ilvl].Quality[qual] × 2,5 )
```

Duas linhas do tooltip saem do **mesmo número cru com arredondamentos
diferentes** — `+0,5` dentro do `floor` na armadura, truncamento puro no Block:

| ilvl | cru      | Armadura                  | `Block`                       |
| ---- | -------- | ------------------------- | ----------------------------- |
| 250  | 766,169  | `floor(766,67)` = 766 ✓   | `floor(1915,42)` = 1915 ✓     |
| 305  | 1052,271 | `floor(1052,77)` = 1052 ✓ | `floor(2630,68)` = **2630** ✓ |

O ilvl 305 é discriminante: `round` daria **2631**. Foi ele que decidiu
truncamento contra arredondamento, e confirmou o `× 2,5` num segundo item level —
o primeiro espécime não fazia nem uma coisa nem outra, porque `766,169 × 2,5` e
`250 × 7,66169` são a mesma equação escrita duas vezes.

**Não procure isso no SimC.** O `parsed_input_t` dele tem um campo de armadura
(`int armor`) e nada de block, porque para simulação o que conta é **chance** de
bloqueio (mastery, parry) e não valor. É limite de requisito dele, não ausência
de dado — a distinção que a seção "o que ele deixa de fazer não é evidência"
manda fazer, aqui aplicada no sentido informativo: se block value fosse dado de
item, estaria no `parsed_input_t`.

E não é dado de item mesmo. Procurando `block` e `shield` em todos os nomes de
tabela do build, a única é a `ItemArmorShield`, que tem três colunas — `ID`,
`Quality`, `ItemLevel`. O `GlobalStrings` mostra as duas eras lado a lado:

| tag                     | texto                         |
| ----------------------- | ----------------------------- |
| `STAT_BLOCK_TOOLTIP`    | `Increases Block Value by %d` |
| `SHIELD_BLOCK_TEMPLATE` | `%s Block`                    |

O primeiro é fóssil de quando block era stat de item; o segundo é o que o cliente
usa hoje — um **formato**, preenchido com número calculado na hora.

### A quinta coluna do `ArmorLocation` NÃO entra

O `ArmorLocation` tem quatro colunas de material **mais** uma `Modifier`, e elas
discordam em alguns slots. Ombro é o caso: `0,11` nas quatro, `0,13` na quinta.

Testado nos seis ranks de um ombro de placa: **`Platemodifier` (0,11) acerta os
seis, `Modifier` (0,13) erra os seis**. O acessor do SimC — `value(subclass − 1)`,
só as quatro primeiras — está certo, e a quinta coluna é outra coisa.

## Arma

```
dpsTabela = ItemDamage{OneHand|TwoHand}[Caster][ilvl].Quality[qual]
speed     = ItemSparse.ItemDelay / 1000

min = floor( dpsTabela × speed × (1 − DmgVariance/2) )
max = floor( dpsTabela × speed × (1 + DmgVariance/2) + 0,5 )
```

### Qual das quatro tabelas de dano

Pelo `InventoryType` e por um **bit de flag**:

|                                               | tabela               |
| --------------------------------------------- | -------------------- |
| `INVTYPE_2HWEAPON` (17)                       | `ItemDamageTwoHand`  |
| uma mão (13, 21, 22)                          | `ItemDamageOneHand`  |
| qualquer uma das duas **com o bit de caster** | a variante `*Caster` |

O bit é `ITEM_FLAG2_CASTER_WEAPON = 0x200`, no **segundo elemento** do
`ItemSparse.Flags`. Medido: uma espada de Intellect tem `65536,8704,…` e
`8704 = 8192 + 512`; as três armas de Strength têm `8192` no mesmo lugar.

### O dps EXIBIDO não é o da tabela

Ele é recalculado a partir do dano **já arredondado**:

```
dpsExibido = arredonda1casa( (min + max) / 2 / speed )
```

| arma       | pela tabela | pela fórmula | tooltip   |
| ---------- | ----------- | ------------ | --------- |
| Scimitar   | 55,3        | **55,2**     | **55,2**  |
| Greatsword | 33,4        | **33,3**     | **33,3**  |
| Bellamy    | 101,5       | **101,4**    | **101,4** |

> Uma versão anterior deste documento dizia que "o dps do tooltip não é
> calculado: é o valor da tabela, direto". Estava errado, e passou porque o
> **único** espécime de arma na época — o machado — dá 10,2 pelos dois
> caminhos. A regra só apareceu com a quinta arma.
>
> É o mesmo modo de falha da seção "O erro que se cancelava", em escala menor:
> um espécime não distingue duas fórmulas que concordam nele.

## Um stat que aparece duas vezes SOMA

O `StatModifier_bonusStat` pode repetir o mesmo tipo em posições diferentes, com
alocações diferentes — e o tooltip mostra a **soma**.

Medido numa espada de duas mãos de caster, com Intellect em duas entradas:

```
alocação  5259 →  89
alocação 18121 → 305
                 ---
tooltip:         394
```

Nenhuma das duas sozinha bate. Somar as alocações **antes** também dá 394 neste
caso (394,14), então o espécime não distingue "somar os arredondados" de
"arredondar a soma" — fica anotado como pergunta aberta.

## O `itemString` NÃO é a fonte completa — existe a árvore de bônus

Esta é a descoberta mais cara da pesquisa toda, e ela chegou no vigésimo
espécime. Um escudo cujo `itemString` é:

```
item:268262::::::::90:66::5:1:3524:1:28:5850:::::
                            ↑ ↑ ↑
              itemContext = 5 │ └─ o único bônus, e ele é Type 0 (no-op)
                 numBonusIDs = 1
```

Um bônus só, e no-op. Mesmo assim o tooltip mostra **`Heroic`**, **`Item Level
305`** e **`Upgrade Level: Hero 1/6`**, com a base do item no `ItemSparse` sendo
**219**.

**Nenhum desses três valores está no `itemString`.**

### O `itemContext` é chave de resolução, não metadado

Quem os fornece são duas tabelas que não estavam extraídas:

```
ItemXBonusTree[ itemID ]           →  a árvore de bônus do item
ItemBonusTreeNode[ árvore ]        →  os nós, cada um com um ItemContext
```

Para o escudo, com `itemContext = 5`:

```
árvore 5741  ctx 5  →  lista 13334  →  Type 4 = 2015    →  "Heroic"
árvore 5998  ctx 5  →  grupo 617    →  (nenhuma lista direta)
                          rank 1 = estado padrão  →  lista 12841
                             Type 34 = 617,974  →  SharedString 974 = "Hero"
                             Type 49 = 314      →  ItemScalingConfig → ilvl 305
```

Três de três. E o `Type 0` do `3524` deixa de ser esquisito: **a peça está no
rank 1, o padrão**, e não existe bônus incrementando nada porque nada foi
incrementado.

### A árvore é um CARDÁPIO — aplicá-la inteira dá item errado

O erro fácil aqui é percorrer a árvore e aplicar tudo. Não funciona: a árvore do
escudo traz as listas `40, 41, 42 e 43`, que são **os quatro terciários**.
Aplicadas juntas, produziriam uma peça com Avoidance, Leech, Speed e
Indestructible ao mesmo tempo.

Quem separa é o `ItemContext` do nó:

| `ItemContext` do nó  | o que é                                                       |
| -------------------- | ------------------------------------------------------------- |
| **0**                | **opção** — o pool de onde o drop sorteia (terciário, socket) |
| **igual ao do item** | **aplicado** — a identidade daquela versão da peça            |

Descer pelos nós de `ctx 0` é necessário (a árvore é hierárquica e os nós
intermediários têm `ctx 0`); **aplicar** os de `ctx 0` é que não.

Medido nos espécimes, resolvendo só os nós de contexto exato:

| peça             | ctx | árvore devolve          | está no `itemString`?    |
| ---------------- | --- | ----------------------- | ------------------------ |
| escudo           | 5   | lista 13334 · grupo 617 | **não, nenhum dos dois** |
| Bellamy          | 6   | lista 13335 · grupo 612 | a lista sim, o grupo não |
| Greataxe         | 60  | lista 13844             | sim                      |
| Bramblebarricade | 174 | lista 11215 · grupo 609 | a lista sim              |
| luva Devouring   | 110 | grupos 609, 610 e 611   | não                      |

### A regra: união dos dois, nunca um ou outro

```
bônus aplicados = bônus do itemString  ∪  nós da árvore com ItemContext igual ao do item
```

Como conjunto — lista que aparece nos dois lados entra uma vez só.

E o grupo de track resolve assim:

- **`Type 34` presente** num bônus do `itemString` → ele diz o grupo **e** o rank
- **ausente** → o grupo vem da árvore, e o rank é **1**, o padrão

O caso da luva mostra por que a ordem importa: a árvore oferece **três** grupos
(609 Veteran, 610 Champion, 611 Hero), e sozinha é ambígua. Quem desempata é o
`Type 34` do `itemString`, que aponta `611`. No escudo a árvore oferece **um**
grupo, e o padrão é inequívoco.

#### A ambiguidade da luva tem nome: é banda de keystone

Os três nós da luva no `itemContext 110` **não** são um cardápio genérico — eles
trazem `MinMythicPlusLevel`/`MaxMythicPlusLevel` preenchidos, nas faixas `4..5`,
`6..7` e `8..11`. É o nível da chave que escolhe.

| espécime           | ctx | faixas de M+ nos nós    |
| ------------------ | --- | ----------------------- |
| luva Devouring     | 110 | `4..5`, `6..7`, `8..11` |
| cinto e elmo Rider | 35  | `0..9`, `10..0`         |

**Isso não muda a regra** — o `Type 34` continua sendo quem desempata, e é o
certo, porque o nível da chave não está em lugar nenhum do `itemString`. Muda a
explicação: a versão anterior atribuía a ambiguidade a "a árvore é um cardápio",
e a causa é mais específica. Os dois campos ficam registrados porque quem
implementar vai encontrá-los preenchidos e precisa saber que **pode ignorá-los,
desde que use o `Type 34`**.

> **Por que os 19 espécimes anteriores fecharam sem isso:** neles o `itemString`
> já trazia a lista que a árvore repetiria. O escudo é o primeiro que depende só
> da árvore — e o modo de falha é o de sempre: sem ela, ele renderiza com o ilvl
> base 219 em vez de 305, **sem erro nenhum**.

## O track de upgrade — resolvido, inteiro

`Upgrade Level: Adventurer 1/6`, sem curadoria e localizável.

```
Type 34 do bônus = ( ItemBonusListGroupID , SharedString.ID )

nome  = SharedString[ segundo valor ].String_lang
entrada = ItemBonusListGroupEntry onde ItemBonusListID = <bonus do itemString>
rank  = entrada.SequenceValue
total = quantas entradas do grupo têm Flags != 3
```

O `Type 34` **não existe no enum do SimC** — eles ignoram, porque não precisam do
tooltip. É achado nosso.

### O `SharedString` é onde os nomes moram

| id  | nome       |
| --- | ---------- |
| 970 | Explorer   |
| 971 | Adventurer |
| 972 | Veteran    |
| 973 | Champion   |
| 974 | Hero       |
| 978 | Myth       |

E casa com os espécimes:

| peça         | `Type 34` | track no tooltip |
| ------------ | --------- | ---------------- |
| ombro        | `614,971` | **Adventurer** ✓ |
| colar        | `616,973` | **Champion** ✓   |
| cinto e anel | `612,978` | **Myth** ✓       |
| escudo       | `617,974` | **Hero** ✓       |

O escudo é o único cujo `Type 34` **não vem do `itemString`** — vem do grupo que
a árvore devolveu, no rank padrão. Ver "O `itemString` NÃO é a fonte completa".

#### O total NÃO é "entradas com o mesmo `Flags`" — e essa versão durou cinco dias

A regra anterior dizia _mesmo `Flags`_, e funcionava nos três primeiros grupos
porque **os três são uniformes**: seis entradas com `Flags 2`, depois 2–3 com
`Flags 3`. As duas regras dão 6 nos dois casos.

O quarto espécime separou. O escudo mostra `Hero 1/6`, e o grupo dele é:

```
grupo 617:  rank 1→2   2→2   3→2   4→0   5→2   6→2   7→3   8→3
```

Pelo mesmo-`Flags` dá **5**, porque o rank 4 tem `Flags 0`. Pelo `!= 3` dá **6**,
que é o que o tooltip diz.

E não é raridade: **193 dos 235 grupos** têm alguma entrada com `Flags 0`. A regra
errada estava errada na maioria dos itens do jogo — nenhum espécime tinha caído
num deles.

> Terceira vez que o mesmo formato aparece: espécimes que concordam entre si não
> distinguem duas regras que concordam neles. As outras duas foram o dps de arma
> e o erro que se cancelava.

O que as entradas de `Flags 3` são continua desconhecido; o que se sabe é que
elas ficam **fora** da contagem.

`Adventurer` aparece duas vezes no `SharedString` (971 e 990), o que sugere um
conjunto por expansão.

### Quando a linha aparece

Peça de season passada **perde a linha**, mesmo com o `Type 34` intacto — o cinto
e o anel apontam para `612,978` e não exibem nada. Quem decide é o **grupo**, não
o item: o `ItemGroupIlvlScalingID` é 11 no grupo 612 e 12 nos grupos 614 e 616.

### Isto reverteu uma conclusão anterior, e o erro de método importa mais

Uma versão anterior desta seção afirmava que **o nome não existia em db2
alcançável pelo item**, com uma tabela de "cinco caminhos independentes, todos
negativos", e tratava como decisivo o fato de o addon
[ItemUpgradeTip](https://github.com/belazor-wow/ItemUpgradeTip) raspar o texto do
tooltip.

Estava errado. E o dado que faltava **estava em mãos desde o começo**: o segundo
valor do `Type 34`. Ele foi testado contra **uma** tabela
(`ItemBonusListGroupEntry`), falhou, e foi arquivado como "desconhecido" em vez
de continuar sendo pergunta.

Dois erros de raciocínio, que valem mais registrados que a solução:

**Ausência de prova tratada como prova de ausência.** Nenhum dos cinco caminhos
testava o campo que importava, então o "cinco" dava à conclusão um peso que ela
não tinha. Cinco buscas no lugar errado não somam evidência.

**E o argumento do addon estava invertido.** Que um addon raspe tooltip mostra
que **aquele caminho é mais conveniente para ele** — o cliente já renderizou a
string, pronta e traduzida. Não mostra que o dado não existe.

> **Regra que sai daqui: campo não decodificado é pergunta aberta, não detalhe.**
> Enquanto houver um número sem significado no caminho, a busca não terminou.

É o espelho do erro da seção "O erro que se cancelava": lá, coincidência foi
tratada como prova; aqui, ausência foi tratada como prova. Os dois vêm de querer
fechar a questão.

## Uma noite de raid inteira, como conferência de estrutura

54 linhas de loot capturadas pelo addon numa raid **que não existia quando esta
pesquisa fechou** — instância nova, seis encontros, 38 itens distintos. Sem
tooltip transcrito, então **não confere número nenhum**; confere resolução.

O que ela estabeleceu:

|                                |                                                                          |
| ------------------------------ | ------------------------------------------------------------------------ |
| 43 drops de equipamento        | **43 resolvidos**, sem adaptação nenhuma no caminho                      |
| seis `ItemScalingConfig` novos | 306–308 e 310–312 → ilvl 279/282/285 e 292/295/298, curva identidade     |
| dois grupos de track novos     | **614 Adventurer, 615 Veteran, 616 Champion**, todos com total 6         |
| a regra do total               | `Flags != 3` fecha nos três, que têm seq 1–6 com `Flags 2` e 7–8 com `3` |

E uma **confirmação negativa**, que vale tanto quanto as positivas: em **39 de 39
pares (item, `itemContext`) a árvore não acrescentou nada** ao `itemString`, e o
grupo de track que ela oferece bate com o `Type 34` explícito nos dois contextos.

Isso não enfraquece a árvore — ela continua obrigatória, e o escudo continua
sendo a prova. O que isso testa é o **outro** lado do erro: a regra da união não
super-aplica. Percorrer a árvore aplicando os nós de `ctx 0` daria a cada peça
desta raid as listas `40, 41, 42, 43` e dois sockets, ou seja Avoidance, Leech,
Speed e Indestructible ao mesmo tempo.

> Escrevendo o conferidor desta rodada eu errei os dois lados antes de reler a
> seção da árvore: primeiro filtrei `ItemContext` na descida (e a árvore devolveu
> vazio), depois aceitei `ctx 0` como aplicável (e ela devolveu os quatro
> terciários). **A regra escrita estava certa nas duas vezes.** Fica registrado
> porque os dois erros são os modos de falha naturais de quem implementa isto.

### Bonus loot: identificado, e é só isso

Bonus loot de raid cai **uma track abaixo** da dificuldade corrente e
`Warbound until equipped`. Os dois sinais estão no `itemString`: o descritor pelo
`Type 4` e o vínculo pelo `Type 46`. Foi o que explicou os sete itens de track
mais baixa dentro de blocos carimbados como Normal — o cabeçalho estava certo.

Isso importa **para renderizar a linha de vínculo**, e para nada além disso.

> **E não vira filtro no import.** A tentação aqui foi propor um: o histórico de
> loot é "a decisão que o conselho tomou" (Regra 7), bonus loot é sorteio
> pessoal, logo o import deveria descartá-lo — e a dificuldade também, já que
> conselho só roda em Heroic para cima.
>
> **Errado, e o motivo generaliza.** Quem decide o que entra é a pessoa que liga
> o RCLootCouncil: se a distribuição não interessa, a extração nem existe. Uma
> noite pode ser Normal sem addon e terminar com um boss Heroic com addon, e o
> arquivo sai certo sozinho.
>
> Código que refizesse isso estaria **reimplementando, pior, uma escolha que um
> humano já faz na hora certa e com contexto que o sistema não tem** — e ainda
> criaria um segundo lugar para discordar do primeiro. É a Regra 7 no outro
> sentido: nada que o fluxo natural já resolva deve exigir feature.

Este arquivo é sobre montar o tooltip. O parágrafo fica porque a hipótese
descartada é o tipo de coisa que alguém propõe de novo.

### O que a noite deixou em aberto

- **modificadores do `itemString`**: o `28` aparece com três valores distintos
  (`1040`, `6011`, `7359`), e surgiram o `29` e o `30`. **Nenhum modificador foi
  analisado até hoje** — nem os que já estavam nos espécimes antigos
- os seis `Type` sem decodificação da tabela acima

## A fixture: as peças que a fórmula reproduz

Critério de aceite da TIT-136: se o cálculo não reproduz estes itens
**exatamente**, ele está errado — e não "quase".

> **Os espécimes estão versionados em [`db2-fixture-de-itens.json`](db2-fixture-de-itens.json)**,
> com `itemString` completo e os números do tooltip.
>
> Coletá-los **não é trivial**: exige ter a peça no jogo, extrair o `itemString`
> pelo addon e transcrever o tooltip à mão. Por isso viram arquivo, e não uma
> tabela em prosa — e por isso o arquivo carrega o build junto.

**~110 valores em 21 espécimes de equipamento**, cobrindo os quatro tipos de
multiplicador (armadura, joia, trinket, arma), as classes de orçamento, primário
fixo e flexível, uma track inteira de seis ranks, os quatro terciários, três
itens de set de classes diferentes, cinco armas (uma mão, duas mãos e caster),
dois escudos, duas off-hand, um item de expansão antiga, e **uma peça Rare** —
a única não-épica, e a que separou a coluna do orçamento.

> **Os 73 valores de stat são o número que importa acompanhar**, porque é o que
> o conferidor roda inteiro a cada mudança de fórmula. Foi ele que expôs a coluna
> INT: 38 de 73 pela regra que estava publicada.

Mais **7 espécimes de não-equipamento** — token de set, decor de casa, cosmético,
reagente — com o tooltip inteiro transcrito, linha a linha.

Um deles é **deliberadamente contaminado** — o cinto com `Sporefused: Myth` — e
está lá marcado como tal, porque foi o espécime que quase produziu uma fórmula
errada com números plausíveis.

## Placar: o que dá para montar hoje

**Resolução de bônus** — o que transforma um `itemString` no item real:

| elemento                            | status                                                 |
| ----------------------------------- | ------------------------------------------------------ |
| `Type` do `ItemBonus`               | ⚠️ enum do SimC **não cobre tudo** — 6 sem decodificar |
| `Type 50` (`APPLY_BONUS`) recursivo | ✅ é o que resolve o item de era antiga                |
| árvore de bônus por `itemContext`   | ✅ 5/5 aplicando, e 39/39 não super-aplicando          |
| item level                          | ✅ 7/7, moderno e de era antiga                        |

**Números do tooltip:**

| elemento                        | status                                               |
| ------------------------------- | ---------------------------------------------------- |
| primário, stamina, secundários  | ✅ **73/73** — com a coluna `EpicF`, não `Epic`      |
| primário flexível               | ✅ enum do SimC, 3 dos 4 tipos observados            |
| terciários                      | ✅ os 4 — Indestructible é flag, os outros medidos   |
| armadura                        | ✅ 11/11, escudos inclusos                           |
| `Block` do escudo               | ✅ 2/2 — `floor( armadura_crua × 2,5 )`              |
| dano, speed, dps                | ✅ 5/5, com a seleção entre as 4 tabelas             |
| on use / proc — texto e números | ✅ 4/4, com o `ScalingClass` decodificado            |
| socket (`penalty`)              | ✅ fórmula do SimC; **termo morto** acima do ilvl 60 |

**Texto e montagem da tela:**

| elemento                       | status                                                    |
| ------------------------------ | --------------------------------------------------------- |
| descritor de dificuldade       | ✅ duas fontes: `Type 4` e `ItemNameDescriptionID`        |
| track (nome, rank, total)      | ✅ 5 grupos — e a regra do total corrigida                |
| set (nome, peças, bônus)       | ✅ 3 sets, e o modo sem personagem vem do próprio cliente |
| flavor text                    | ✅ `ItemSparse.Description_lang`                          |
| vínculo, três estados          | ✅ `Bonding`, o bit 27 do `Flags[0]` e o `Type 46`        |
| item que não é equipamento     | ✅ 7 tooltips reais, 4 formatos                           |
| números dentro do texto de set | ⏸️ fora do caminho: o padrão é a linha genérica           |
| `Type 38` do `ItemBonus`       | ⏸️ redundante — repete o `InventoryType` que já temos     |

## O que ainda está aberto

Esta seção já disse **"Nada"** duas vezes, e nas duas estava errada.

| rodada    | declarou fechado | o que derrubou                                |
| --------- | ---------------- | --------------------------------------------- |
| penúltima | tudo             | um **escudo** → o `Block` e a árvore de bônus |
| última    | tudo             | um peito **Rare** de bag → a coluna `EpicF`   |

Nos dois casos o que derrubou foi **um espécime real que ninguém tinha motivo
para coletar**, aparecendo depois de a pesquisa "estar fechada". Nos dois o
espécime foi mostrado de passagem, sem relação com nenhuma pendência da lista.

> **A lição de método, agora com duas ocorrências:** o documento não tem como
> saber o que não sabe. O que corrigiu não foi o raciocínio — foi o hábito de
> continuar olhando peça real depois de declarar o fim.
>
> Consequência prática: **esta seção nunca mais escreve "nada".** O que ela pode
> dizer é o que está aberto e conhecido, que é o de baixo.

### Aberto e conhecido

| o quê                                                  | o que fecharia                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| seis `Type` sem decodificar (7, 9, 16, 26, 37, 47)     | achar um espécime em que um deles altere um valor conferível           |
| `DamageReplaceStat` / `DamageSecondary`: float ou INT? | um trinket de `ScalingClass −8` com tooltip transcrito                 |
| modificadores do `itemString` (28, 29, 30)             | nunca foram analisados — nem os que já estão na fixture                |
| `ItemLevelSelector` pela árvore                        | um espécime cujo nó de contexto exato traga `ChildItemLevelSelectorID` |

Nenhum dos quatro bloqueia a implementação: os seis `Type` não apareceram mexendo
em valor conferido, a escolha de coluna afeta só efeito de trinket, os
modificadores nunca foram necessários para nenhuma linha reproduzida, e nenhum
dos 69 pares (item, contexto) conferidos passou pelo `ItemLevelSelector`. **Mas
isso é o mesmo formato de argumento que falhou com o `Type 50`** — "não vi
mexer" não é "não mexe".

O último da lista é o mais desconfortável dos quatro, porque é **literalmente a
forma da árvore de bônus**: um caminho que existe no dado, que nenhum espécime
nosso percorreu, e que erraria em silêncio. A diferença é que a árvore ninguém
tinha olhado, e este está escrito.

### As pendências antigas terminaram assim

As que esta lista carregou por sete rodadas:

| era pendência                  | virou                                                          |
| ------------------------------ | -------------------------------------------------------------- |
| squish de era antiga           | **não existia** — faltava expandir o `Type 50`                 |
| `Block` do escudo              | **fechado** — `floor( cru × 2,5 )`, dois espécimes             |
| não-equipamento sem fixture    | **conferido** — e a conferência reprovou cinco afirmações      |
| socket nativo                  | **decisão de não procurar** — termo morto acima do ilvl 60     |
| tabela geral de `ScalingClass` | **não existe** — o campo não assume valor positivo neste build |
| `Type 38`                      | **redundante** — repete o `InventoryType`                      |
| números do texto de set        | **fora do caminho** — o padrão é a linha genérica              |
| efeito com `ScalingClass 0`    | **inalcançável** — 2 casos em 45.115, nenhum é loot de raid    |

> **Quatro das oito não eram pendências**: eram perguntas mal formuladas, que
> sumiram quando a pergunta certa foi feita. Vale registrar porque o padrão se
> repete — a primeira reação a um número que não fecha foi supor **mecanismo
> faltando** (squish, tabela geral de `ScalingClass`), e nas duas vezes o
> mecanismo não existia.
>
> E as outras quatro se dividem limpo: duas fecharam com espécime novo (`Block`,
> não-equipamento) e duas viraram **decisão registrada de não perseguir** (socket
> nativo, `ScalingClass 0`) — as duas com o número que justifica a decisão.

## Consultar outro projeto funciona — mas o que ele NÃO faz não é evidência

| projeto                                                         | o que deu                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| [SimulationCraft](https://github.com/simulationcraft/simc)      | a fórmula de stat inteira, depois de eu reconstruí-la errada |
| [ItemUpgradeTip](https://github.com/belazor-wow/ItemUpgradeTip) | o formato `Upgrade Level: %s %d/%d` — e uma conclusão errada |

O primeiro é o caso de ouro: código de terceiro, validado contra o jogo inteiro,
substituindo medição nossa.

**O segundo é uma armadilha, e vale saber por quê.** O addon raspa o texto do
tooltip, e disso eu concluí que o nome da track não existia em dado. Errado: o
addon raspa porque o cliente **já renderizou a string, pronta e traduzida** —
para um addon isso é sempre mais barato que percorrer db2. Ele escolheu o caminho
conveniente, não o único.

> **O que outro projeto faz é evidência; o que ele deixa de fazer não é.** Cada
> projeto para onde os requisitos dele param — o SimC não precisa do tooltip, o
> addon não precisa dos db2.

### O `dbfile` do SimC lista o que eles TENTAM extrair

Não o que existe no build atual. Três arquivos sugeridos a partir dele —
`ItemUpgrade`, `RulesetItemUpgrade`, `RulesetRaidLootUpgrade` — falharam no
`wow.export` com

```
Failed to open CASC file: fileDataID does not exist in root
```

Foram removidos do cliente há expansões, e o SimC os mantém na lista por
histórico. **A lista serve para descobrir nome e tipo de um arquivo; não é prova
de que ele existe.**

## A disciplina, que não é zelo

### Nunca derivar por aritmética

Os blocos de bonus são regulares de um jeito tentador: as dificuldades sobem de
8 em 8, e a season seguinte é a atual **+48** exato nos três casos observados.

**Isso serve para gerar hipótese e conferir, jamais para rodar em produção.** É
a mesma família da armadilha do `responseID` posicional do RCLootCouncil:
funciona até a season em que não funciona, e falha sem erro.

### A fixture de item real é necessária — e não é suficiente

Um dos espécimes analisados — um cinto mítico com `Sporefused: Myth` — tinha
**primário e stamina seguindo o ilvl exibido e secundários seguindo ~4 abaixo**.
Mecânica de season.

Ele era o "melhor" espécime disponível: o mais novo, o mítico. **Calibrar nele
teria produzido uma fórmula errada com números plausíveis**, e ninguém notaria
até conferir peça por peça contra o jogo.

É o modo de falha que a TIT-136 descreve — _um stat calculado errado é
indistinguível de um certo, e o conselho vota nele_ — materializado na primeira
hora de análise.

> **E "mecânica de season" não é categoria homogênea.** Uma maça com
> `Ascendant Voidforged: Myth` — mesma família de descritor — fecha nos quatro
> stats sem desvio nenhum. Saber que uma perturba não diz nada sobre a outra:
> **cada mecânica precisa ser verificada por conta própria**, e a fixture marca
> individualmente qual está contaminada.

Daí a regra: **stat que não dá para calcular com confiança volta `null`, e a
tela mostra a lacuna.** Nunca um valor aproximado, nunca o do item base quando o
modificador não foi entendido.

**Mas fixture sozinha não basta**, e este documento tem a prova: sete peças
reais fecharam com uma fórmula errada, porque dois erros se cancelavam (ver "O
erro que se cancelava"). Fixture detecta fórmula **errada**; não detecta fórmula
**certa por acaso**.

O que separa os dois casos é uma fonte independente — no nosso caso o SimC. A
ordem certa é: **implementação vem da fonte, fixture confirma que entendemos o
que copiamos.** O inverso — deduzir da fixture — é o que produziu a maior parte
dos erros registrados aqui.

## O procedimento a cada patch

1. `/run print(GetBuildInfo())` — anota o build
2. extrai as tabelas com o `wow.export` — os db2 na aba `Data`, os três
   GameTables de multiplicador na aba `Text`
3. carrega no SQLite local
4. exporta os `itemId` do catálogo pela rota de ops
5. roda a query de extração, filtrando por eles
6. carrega o arquivo tratado pela rota de ops
7. roda o relatório de **"o que ainda não conhecemos"** (TIT-82) — bônus sem
   tradução, itens sem catálogo e itens catalogados sem dado de stat

O passo 7 é o que faz o dicionário crescer por evidência em vez de por palpite,
e é o único aviso de que o catálogo cresceu sem a carga correspondente ter sido
refeita. **Início de season: cataloga a raid, roda o relatório, recarrega o que
faltou.**
