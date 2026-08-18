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
entendemos o que copiamos; foi assim que as sete peças da fixture viraram
verificação em vez de fonte.

## Regra que vale para os dois lados

**A app nunca fala com o wago.tools nem lê `.db2`.** O arquivo é obtido à mão,
convertido à mão, e entra por rota de ops — mesma separação do `catalog-load`.

Some a chamada externa, some rate limit, e some o dia em que a fonte muda de
formato e um job nosso quebra em produção.

## Quais tabelas, e o que cada uma responde

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
| `ItemBonusListGroupEntry` | `SequenceValue` (o rank), o grupo, e o `Flags` que define o total      |
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

### Fora do escopo atual, mas já extraídas

`ItemArmorTotal`, `ItemArmorQuality`, `ItemArmorShield` (armadura);
`ItemDamageOneHand`, `ItemDamageTwoHand` e as variantes `*Caster` (dano de
arma); `Item` (class/subclass, que o nosso catálogo já tem); `SpellScaling` e
`ExpectedStat` — esta última é indexada por **nível de personagem**, não por
item level, então provavelmente não é o que a escala de efeito precisa.

Armadura e dano de arma abrem issue própria — têm fórmula e conjunto de tabelas
próprios.

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

## A fórmula

**Reproduz 19 de 19 stats em 7 peças reais**, sem nenhuma constante ajustada à
mão.

```
idx     = random_suffix_type( itemClass, itemSubclass, inventoryType )
budget  = RandPropPoints[ilvl].Epic[idx]
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

### Duas coisas menores, ambas confirmadas

|                |                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| arredondamento | **`round`**, nunca truncamento                                                                                                                                                                             |
| qualidade      | **irrelevante na prática** — `Epic` = `Superior` = `Good` em **1300 de 1300** linhas. O SimC escolhe a coluna por qualidade (épico/lendário → `p_epic`, raro → `p_rare`), e neste build as três são iguais |

> **Esta seção substitui uma versão errada.** A anterior afirmava que quatro
> slots diferentes usavam todos o índice 1, que o primário mudava de regra por
> categoria, e que stamina tinha uma constante 7,402. Ver "O erro que se
> cancelava" adiante.

### O `Type` do `ItemBonus` — o enum completo

Não precisa ser decodificado à mão: está nomeado no `engine/dbc/data_enums.hh`
do SimC, em `enum item_bonus_type`.

| Type | nome                    | Type | nome                     |
| ---- | ----------------------- | ---- | ------------------------ |
| 1    | `ILEVEL`                | 25   | `MOD_ITEM_STAT`          |
| 2    | `MOD` (acrescenta stat) | 36   | `ILEVEL_IN_PVP`          |
| 3    | `QUALITY`               | 42   | `SET_ILEVEL_2`           |
| 4    | **`DESC`**              | 48   | `SQUISH_CURVE`           |
| 5    | `SUFFIX`                | 49   | **`SCALE_CONFIG`**       |
| 6    | `SOCKET`                | 50   | `APPLY_BONUS`            |
| 8    | `REQ_LEVEL`             | 51   | `SCALE_CONFIG_2`         |
| 11   | `SCALING`               | 52   | `CRAFTING_QUALITY`       |
| 13   | `SCALING_2`             | 53   | `POST_SQUISH_ITEM_LEVEL` |
| 14   | `SET_ILEVEL`            | 17   | `ADD_RANK`               |
| 23   | `ADD_ITEM_EFFECT`       | 50   | **`APPLY_BONUS`**        |

Os quatro que tinham sido decodificados à mão (1, 2, 3, 6) estão certos. E há um
comentário no fonte que confirma uma medição nossa: **`QUALITY` "seems unused as
of Midnight"** — coerente com `Epic` = `Superior` = `Good` em 1300 de 1300
linhas do `RandPropPoints`.

O `Type 2` **valida cruzado** os ids de stat terciário: bonus 40 → `63,3000`;
41 → `62,3000`; 42 → `61,3000`; 43 → `64,3000`, ou seja **63=Avoidance,
62=Leech, 61=Speed, 64=Indestructible**.

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

Nos **19 espécimes** o penalty é zero, e isso não é amostra pequena. Medindo o
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

  −7                       → Epic[0] × CombatRatingsMultByILvl
  −8                       → RandPropPoints.DamageReplaceStat
  0 (PLAYER_NONE) e −9     → RandPropPoints.DamageSecondary
  resto (−1 a −6, −10)     → RandPropPoints.Epic[0]
```

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

Isso produziu quatro afirmações erradas, todas registradas como "medidas":

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

E casa com os três espécimes:

| peça         | `Type 34` | track no tooltip |
| ------------ | --------- | ---------------- |
| ombro        | `614,971` | **Adventurer** ✓ |
| colar        | `616,973` | **Champion** ✓   |
| cinto e anel | `612,978` | **Myth** ✓       |

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

## A fixture: as peças que a fórmula reproduz

Critério de aceite da TIT-136: se o cálculo não reproduz estes itens
**exatamente**, ele está errado — e não "quase".

> **Os espécimes estão versionados em [`db2-fixture-de-itens.json`](db2-fixture-de-itens.json)**,
> com `itemString` completo e os números do tooltip.
>
> Coletá-los **não é trivial**: exige ter a peça no jogo, extrair o `itemString`
> pelo addon e transcrever o tooltip à mão. Por isso viram arquivo, e não uma
> tabela em prosa — e por isso o arquivo carrega o build junto.

**121 valores em 20 espécimes**, cobrindo os quatro tipos de multiplicador
(armadura, joia, trinket, arma), as três classes de orçamento, primário fixo e
flexível, uma track inteira de seis ranks, os quatro terciários, três itens de set de
classes diferentes, cinco armas (uma mão, duas mãos, caster), um escudo, uma
duas off-hand, dois escudos, e um item de expansão antiga.

Um deles é **deliberadamente contaminado** — o cinto com `Sporefused: Myth` — e
está lá marcado como tal, porque foi o espécime que quase produziu uma fórmula
errada com números plausíveis.

## Placar: o que dá para montar hoje

| elemento                              | status                                                    |
| ------------------------------------- | --------------------------------------------------------- |
| item level                            | ✅ 6/6, moderno e de era antiga                           |
| primário, stamina, secundários        | ✅ **43 stats**                                           |
| primário flexível (todos os tipos)    | ✅ enum do SimC, 3 dos 4 observados                       |
| armadura                              | ✅ 11/11, escudos inclusos                                |
| dano, speed, dps                      | ✅ 5/5, com a seleção entre as 4 tabelas                  |
| descritor (Mythic / Mythic+ / Heroic) | ✅ 3/3                                                    |
| `Type` do `ItemBonus`                 | ✅ enum completo, do SimC                                 |
| track completo (nome, rank, total)    | ✅ 5 grupos — e a regra do total corrigida                |
| **on use / proc — texto e números**   | ✅ 4/4, com o `ScalingClass` decodificado                 |
| **terciários**                        | ✅ os 4; Indestructible é flag, os outros 3 medidos       |
| **set** (nome, peças, bônus por spec) | ✅ 2 sets, e o modo sem personagem vem do próprio cliente |
| item level (era antiga)               | ✅ era `Type 50` não expandido, não squish                |
| flavor text                           | 🔧 é ler o `ItemSparse.Description_lang`                  |
| **item que não é equipamento**        | ✅ 7 tooltips reais, 4 formatos                           |
| socket (`penalty`)                    | ✅ fórmula do SimC; termo morto acima do ilvl 60          |
| números dentro do texto de set        | ⏸️ fora do caminho: o padrão é a linha genérica           |
| `Type 38` do `ItemBonus`              | ⏸️ redundante — repete o `InventoryType` que já temos     |
| **`Block` do escudo**                 | ✅ 2/2 — `floor( armadura_crua × 2,5 )`                   |
| **resolução pela árvore de bônus**    | ✅ 5/5 — `itemContext` sobre `ItemBonusTreeNode`          |

## O que ainda está aberto

**Nada bloqueia.** O escudo que faltava chegou, fechou o `Block`
— e revelou a árvore de bônus, que era um buraco que ninguém sabia que existia.

Fica registrado o que ele custaria se não tivesse aparecido: **o popover
renderizaria peças com o item level base**, silenciosamente. Não era pendência
conhecida; era pendência invisível, e a única coisa que a expôs foi continuar
coletando espécimes depois de a pesquisa "estar fechada".

> **A lição de método:** a rodada anterior deste documento declarou a pesquisa
> encerrada. Estava errada, e não por descuido — por não haver como saber. O que
> corrigiu foi o hábito, não o raciocínio: mais um espécime real.

As pendências que esta lista carregou por sete rodadas terminaram assim:

| era pendência                  | virou                                                          |
| ------------------------------ | -------------------------------------------------------------- |
| squish de era antiga           | **não existia** — faltava expandir o `Type 50`                 |
| `Block` do escudo              | **fechado** — `floor( cru × 2,5 )`, dois espécimes             |
| não-equipamento sem fixture    | **conferido** — e a conferência reprovou cinco afirmações      |
| socket nativo                  | **decisão de não procurar** — termo morto acima do ilvl 60     |
| tabela geral de `ScalingClass` | **não existe** — o campo não assume valor positivo neste build |
| `Type 38`                      | **redundante** — repete o `InventoryType`                      |
| números do texto de set        | **fora do caminho** — o padrão é a linha genérica              |

> Três das cinco não eram pendências: eram **perguntas mal formuladas**, que
> sumiram quando a pergunta certa foi feita. Vale registrar porque o padrão se
> repete — a primeira reação a um número que não fecha foi supor mecanismo
> faltando (squish, tabela geral), e nas duas vezes o mecanismo não existia.

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
que copiamos.** O inverso — deduzir da fixture — é o que produziu os quatro
erros registrados aqui.

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
