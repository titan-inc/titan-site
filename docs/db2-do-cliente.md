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

| tabela           | responde                                                                           | tamanho |
| ---------------- | ---------------------------------------------------------------------------------- | ------- |
| `ItemSparse`     | ilvl base, qualidade, `InventoryType`, **quais stats** e a **alocação** de cada um | ~59 MB  |
| `RandPropPoints` | o **orçamento** de pontos de stat para cada item level                             | pequena |
| `ItemBonus`      | o que cada bonus id modifica                                                       | média   |

### Para resolver o item level

| tabela                    | papel                                                     |
| ------------------------- | --------------------------------------------------------- |
| `ItemScalingConfig`       | `ItemLevel`, `ItemOffsetCurveID`, `ItemSquishEraID`       |
| `ItemOffsetCurve`         | `CurveID` + `Offset` — o par que transforma o valor acima |
| `CurvePoint`              | os pontos da curva, interpolados                          |
| `ContentTuning`           | teto de nível em alguns caminhos                          |
| `ItemBonusListLevelDelta` | lista de bonus → delta de ilvl (caminho antigo)           |

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
| 23   | `ADD_ITEM_EFFECT`       |      |                          |

Os quatro que tinham sido decodificados à mão (1, 2, 3, 6) estão certos. E há um
comentário no fonte que confirma uma medição nossa: **`QUALITY` "seems unused as
of Midnight"** — coerente com `Epic` = `Superior` = `Good` em 1300 de 1300
linhas do `RandPropPoints`.

O `Type 2` **valida cruzado** os ids de stat terciário: bonus 40 → `63,3000`;
41 → `62,3000`; 42 → `61,3000`; 43 → `64,3000`, ou seja **63=Avoidance,
62=Leech, 61=Speed, 64=Indestructible**.

### O item level dos itens modernos

`Type 49` (`SCALE_CONFIG`) é a resposta, e o caminho é:

```
ItemScalingConfig[ valor_do_bonus ]
  → ItemOffsetCurve[ ItemOffsetCurveID ]  →  { CurveID, Offset }

ilvl = round( curve_point_value( CurveID, ItemScalingConfig.ItemLevel ) ) + Offset
```

Verificado em quatro configs, todas exatas: 289, 292, 295, 298.

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
> multiplicador. Nas sete peças analisadas o penalty real é **zero** — nenhuma
> nasce com socket.

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

### `ScalingClass −1` escala pelo orçamento do item

Medido no trinket, contra os dois ranks:

|                 | derivado do tooltip | `RandPropPoints.EpicF[0]` |
| --------------- | ------------------- | ------------------------- |
| Strength rank 1 | 242,34              | **242,44** (ilvl 292)     |
| Strength rank 2 | 249,27              | **249,31** (ilvl 295)     |

Erro menor que o arredondamento do inteiro exibido, em dois pontos
independentes.

**Isto dá um jeito de LER o item level real de uma peça** — útil para a TIT-82,
e foi como se descobriu que o trinket estava em 292/295, e não em 290/292 como o
orçamento de stat sugeria.

> **Correção de estimativa.** Uma versão anterior deste documento e da TIT-136
> tratavam efeito de trinket como o pedaço mais caro de todos. Não é: é uma
> consulta e uma multiplicação. O custo real está em identificar a tabela de
> escala por `ScalingClass`.

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

## A fixture: as sete peças que a fórmula reproduz

Critério de aceite da TIT-136. Cada linha é `itemString` + os números exatos que
o tooltip mostrou.

| peça                             | item   | ilvl | stats conferidos                      |
| -------------------------------- | ------ | ---- | ------------------------------------- |
| Relentless Rider's Chain (cinto) | 249967 | 289  | Str 93, Sta 1745, Mastery 88, Crit 35 |
| Platinum Star Band (anel)        | 193708 | 289  | Sta 1309, Crit 199, Mastery 104       |
| Wallcliber's Hatchet (1H)        | 204279 | 82   | Agi 9, Sta 16, Haste 12, Vers 6       |
| Blazebinder's Hoof (trinket) r1  | 193762 | 292  | Haste 119                             |
| Blazebinder's Hoof r2            | 193762 | 295  | Haste 121                             |
| Pendant of Malefic Fury r1       | 251142 | 292  | Sta 1353, Haste 97, Mastery 212       |
| Pendant of Malefic Fury r2       | 251142 | 295  | Sta 1402, Haste 100, Mastery 217      |

Cobre os quatro tipos de multiplicador (armadura, joia, trinket, arma), três
classes de orçamento (1, 2, 3), dois ranks do mesmo item, e um item pós-squish
de expansão antiga.

**Falta na fixture**: peça com socket nativo (`StatPercentageOfSocket` não-zero)
— nenhuma das sete tem, então o `penalty` nunca foi exercitado com valor
diferente de zero.

## Placar: o que dá para montar hoje

| elemento                              | status                                                   |
| ------------------------------------- | -------------------------------------------------------- |
| item level (item moderno)             | ✅ fórmula completa, 4/4                                 |
| primário, stamina, secundários        | ✅ 19/19 stats em 7 peças                                |
| descritor (Mythic / Mythic+ / Heroic) | ✅ 3/3                                                   |
| `Type` do `ItemBonus`                 | ✅ enum completo, do SimC                                |
| terciários                            | ⚠️ mecanismo conhecido, **nenhum espécime** ainda        |
| socket                                | ⚠️ fórmula conhecida, `penalty` foi 0 nas 7 peças        |
| on use / proc                         | ⚠️ texto, `$d` e `$u` sim; escala por `ScalingClass` não |
| dano de arma, armadura                | 🔧 tabelas extraídas, fórmula não transcrita             |
| flavor text                           | 🔧 é ler o `ItemSparse.Description_lang`                 |
| item level (era antiga)               | ❌ ver abaixo                                            |
| track de upgrade (Champion x/y)       | ❌ não investigado                                       |

## O que ainda está aberto

- **peça com socket nativo**, para exercitar o `penalty` de verdade
- **`ScalingClass −8`** (o dano de fogo do trinket) não segue a regra do −1, e a
  tabela geral de escala por `ScalingClass` não foi identificada
- **item level de era antiga**: o machado de Dragonflight usa `Type 1`
  (`ILEVEL`, +13) sobre a base 415, o que dá 428 — e o tooltip mostra **82**.
  Falta o passo de squish. O SimC tem `ITEM_BONUS_SQUISH_CURVE`,
  `POST_SQUISH_ITEM_LEVEL` e uma constante `SQUISH_CURVE_MIDNIGHT`; nenhum foi
  investigado

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
