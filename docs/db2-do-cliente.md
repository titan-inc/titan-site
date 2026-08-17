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

| tabela                                          | papel                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `ItemBonusListLevelDelta`                       | lista de bonus → delta de ilvl                                              |
| `ItemLevelSelector`, `ItemLevelSelectorQuality` | quando o ilvl vem de seletor                                                |
| `CurvePoint`, `ContentTuning`                   | escalonamento                                                               |
| `ItemScalingConfig`                             | `ItemOffsetCurveID`, `ItemLevel`, `ItemSquishEraID` — ainda não investigada |

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

## O que já foi medido

Contra quatro peças reais, com os números do tooltip anotados. **Não é dedução:
cada linha abaixo foi reproduzida.**

### A fórmula do stat secundário

```
valor = round( RandPropPoints.Epic[classeDeSlot] × ItemSparse.StatPercentEditor[i] / 10000 )
```

Três decisões que a implementação ingênua erra:

|                     |                                                                       |
| ------------------- | --------------------------------------------------------------------- |
| coluna do orçamento | **`Epic` (INT)**, nunca `EpicF`                                       |
| arredondamento      | **`round`**, nunca truncamento                                        |
| qualidade           | **ignorar** — `Epic` = `Superior` = `Good` em **1300 de 1300** linhas |

A combinação importa: com `EpicF` + truncamento, o Strength de um cinto errava
por 1 e o Crit acertava. Com `Epic` INT + `round`, os três stats fecham.

Verificado em cinto (`InventoryType` 6), trinket (12) e machado de uma mão (13)
— os três com secundários no **índice 1** do orçamento.

As 5 classes de orçamento têm multiplicadores **1.0 / 0.75 / 0.5625 / 0.5 / 0.5**.

### Primário e stamina NÃO seguem essa regra

O achado que mais muda escopo. Num machado 1H no ilvl 82:

| stat               | fecha no índice                          |
| ------------------ | ---------------------------------------- |
| Haste, Versatility | **1**                                    |
| Agility            | **3**                                    |
| Stamina            | **nenhum** — fica entre o índice 2 e o 1 |

Num cinto, o Strength fechava no índice 1 **junto** com os secundários.

Ou seja: **a regra do primário depende da categoria do item** (arma × armadura),
e stamina tem regra própria em ambos — medida em ~12,5× num cinto e ~9,7× em
colares. O `RandPropPoints` tem `DamageReplaceStat`/`DamageSecondary`, que
existem para arma e provavelmente são a chave desse caso.

**São pelo menos três fórmulas, não uma.**

### O `Type` do `ItemBonus`

| Type  | é                   | evidência                                                            |
| ----- | ------------------- | -------------------------------------------------------------------- |
| **1** | delta de item level | faixa −900 a 900, idêntica à do `ItemBonusListLevelDelta`            |
| **2** | acrescenta stat     | bonus 40 → `63,3000`; 41 → `62,3000`; 42 → `61,3000`; 43 → `64,3000` |
| **3** | qualidade           | `4` = épico                                                          |
| **6** | socket              | `1,7,0,0` — um socket, tipo 7                                        |

Isso **valida cruzado** os ids de stat terciário contra o que a TIT-82 já sabia
por outro caminho: **63=Avoidance, 62=Leech, 61=Speed, 64=Indestructible**.

### O custo de socket, e a distinção que o `itemString` não faz

Está em `ItemSparse.StatPercentageOfSocket`, não-zero em **12.260 itens** — os
que **nascem** com socket. Formato de percentual por stat.

Socket **nativo** custa orçamento; socket **adicionado** por consumível não
custa. Só que os dois viram bonus `Type 6` idêntico (`1,7,0,0`), então **o
`itemString` sozinho não distingue** — quem distingue é o `StatPercentageOfSocket`
do item base.

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

### O deslocamento do track de upgrade

O orçamento de stat **não** usa o item level da peça quando ela está num track:

| peça                  | item level real | orçamento corresponde a |
| --------------------- | --------------- | ----------------------- |
| trinket rank 1        | 292             | ilvl **290**            |
| trinket rank 2        | 295             | ilvl **292**            |
| colar rank 2          | 295             | ilvl **292**            |
| **cinto** (sem track) | 289             | ilvl **289**            |

As três peças com "Upgrade Level: Champion X/6" ficam ~3 abaixo; a peça sem
track fica em zero. É o que explica o déficit dos colares, que antes parecia
ruído.

## O que ainda está aberto

- **`ScalingClass −8`** (o dano de fogo do trinket) não segue a regra do −1: os
  dois ranks dariam ilvl 295 e ~298,5, um passo de 3,5 contra os 3 do Strength
- **a regra exata do deslocamento de track** — o padrão de ~3 está medido em
  três peças, mas o colar rank 1 exige orçamento 177, que não existe em índice
  nenhum
- **a regra do primário por categoria** e o **multiplicador de stamina**
- **o mapeamento completo `InventoryType` → índice** — medidos só 6, 12 e 13
- **o item level**: não sai do `Type 49`. Nos colares ele vale 310 e 311
  (diferença de 1) enquanto o ilvl exibido difere de 3, e esses ids **não
  existem** no `ItemLevelSelector`. `ItemScalingConfig`, `ItemSquishEraID`,
  `PlayerLevelToItemLevelCurveID` e `ItemLevelOffsetCurveID` ainda não foram
  investigados

### O que fecharia cada uma

- **o mesmo item com e sem socket nativo** — isola o custo sem confundir com
  slot ou track
- **duas peças do mesmo slot com stamina em ilvls diferentes** — o multiplicador
- peças em slots ainda não testados (anel, capa, luvas), **sem track de upgrade
  e sem mecânica de season**
- para o `ScalingClass −8`: um segundo item com efeito de dano, para separar o
  que é da classe de escala do que é daquele trinket

## A disciplina, que não é zelo

### Nunca derivar por aritmética

Os blocos de bonus são regulares de um jeito tentador: as dificuldades sobem de
8 em 8, e a season seguinte é a atual **+48** exato nos três casos observados.

**Isso serve para gerar hipótese e conferir, jamais para rodar em produção.** É
a mesma família da armadilha do `responseID` posicional do RCLootCouncil:
funciona até a season em que não funciona, e falha sem erro.

### A fixture de item real é o único detector

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

## O procedimento a cada patch

1. `/run print(GetBuildInfo())` — anota o build
2. extrai as tabelas com o `wow.export`
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
