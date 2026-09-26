# Titan Bet — total flutuante do slip e odds em jogo na home

> **Status: especificação (26/09/2026).** Estende `docs/specs/titan-bet.md` (D-79 e D-80)
> sem alterar nenhuma decisão anterior. **Só front:** nenhuma migration, nenhum endpoint,
> nenhum schema novo no shared, nenhuma request nova no Yaak.

## 1. Pedido

1. Enquanto o membro preenche o slip, um indicativo **flutuante** mostra o **total de gold
   que está sendo apostado**, atualizado a cada escolha ou stake alterado, mesmo com a
   página rolada até o fim.
2. Na tela inicial do Titan Bet (`/interno/bet`, **não** o Officer Panel), mostrar as
   **odds que têm valor** — só as opções com aposta corrente na rodada aberta —, agrupadas
   por mercado e **ordenadas da que mais paga para a que menos paga** ao apostador.

## 2. Decisões

| ID       | Decisão                                                                                                                                                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-79** | O total flutuante é **rascunho local**: soma dos stakes das apostas da tela, sem chamar a API. Não é o `expectedTotal` (esse nasce no Submeter e é do backend); é o que a tela mostraria se o membro salvasse agora.                                                                   |
| D-79a    | Só entra na soma mercado **com opção escolhida** e stake **válido** (inteiro, `STAKE_MINIMO..STAKE_MAXIMO` do shared). Stake inválido não entra e é **sinalizado**, nunca somado em silêncio — a soma mostrada tem que ser a que o Salvar aceitaria.                                   |
| D-79b    | Aparece só quando a tela é **editável** (`editavel`). Sem rascunho para editar não há o que somar.                                                                                                                                                                                     |
| D-79c    | Indica se a tela difere do rascunho salvo (`alteradoDesdeSalvo`, já existente): "não salvo".                                                                                                                                                                                           |
| **D-80** | A home lista as odds da **rodada aberta** (`fase === 'OPEN'`; a primeira da lista, que já vem da mais recente). Sem rodada aberta, a seção não aparece.                                                                                                                                |
| D-80a    | "Tem valor" = `multiplicador !== null`, ou seja, existe aposta **válida** (slip `valido`, D-12) naquela opção. Slip pendente não conta — mesmo critério das odds da rodada.                                                                                                            |
| D-80b    | Ordenação: **multiplicador decrescente** dentro de cada mercado (a odd que mais paga primeiro). Empate: nome e depois realm, crescentes — ordem determinística, sem "primeiro que chegou".                                                                                             |
| D-80c    | Mercado sem nenhuma opção com valor **não aparece**. Nenhum mercado com valor → estado vazio explícito ("ainda não há apostas confirmadas"), não seção omitida: quem chega cedo na semana precisa saber que é vazio, não quebrado.                                                     |
| D-80d    | Ordem dos mercados = a do cardápio da rodada (a mesma da tela de apostas).                                                                                                                                                                                                             |
| D-80e    | Falha ao ler cardápio ou odds **esconde a seção**, sem derrubar a lista de rodadas (Regra 6, degradar). Odds e cardápio seguem o guard da rota (D-53b): quem vê a lista vê as odds.                                                                                                    |
| D-80f    | Cada mercado e a seção linkam a página da rodada (`/interno/bet/:roundId`), a mesma que o Discord linka (Regra 7).                                                                                                                                                                     |
| D-80g    | Privacidade: sai apenas o multiplicador, o mesmo dado que `GET .../odds` já publica (§16.10). A lista filtrada não revela nada que a tela da rodada não revele — quem tem "—" já é a ausência de aposta. O risco de opção com um único apostador (§8.5) é o já aceito, não é ampliado. |

O multiplicador é `P / S(o)`: quanto **menos** gold há na opção, **mais** ela paga. A ordem
D-80b, portanto, põe primeiro as opções com **menos** gold apostado.

## 3. Cálculo

```
totalDoRascunho(cardapio, escolhas):
  para cada mercado do cardápio com escolhas[mercado].opcao definido:
    n = Number(stake)
    se inteiro e STAKE_MINIMO ≤ n ≤ STAKE_MAXIMO → total += n
    senão                                        → stakesInvalidos += 1
  devolve { total, mercadosEscolhidos, mercadosTotal, stakesInvalidos }

oddsComValor(cardapio, odds):
  para cada mercado do cardápio (na ordem), com o mercado nas odds:
    opcoes = odds.opcoes com multiplicador != null, com nome resolvido pelo cardápio
             (candidato → name/realm; boss de progressão → encounterName)
    descarta a opção sem nome no cardápio (dado inconsistente não vira tela)
    ordena por multiplicador desc, nome asc, realm asc
  descarta mercados sem opções
```

Sem redeclarar regra (Regra 2): os limites do stake vêm do shared; a decisão de quem é
candidato de cada mercado continua do backend (as odds já trazem só os candidatos válidos).

## 4. Arquivos

| Arquivo (`apps/web/app/interno/bet/`)      | Mudança                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `_components/total-do-rascunho.ts` (+spec) | função pura do D-79                                                                               |
| `_components/total-flutuante.tsx` (+spec)  | barra `sticky bottom-0`, `role="status"`, respeita safe-area                                      |
| `_components/apostas-da-rodada.tsx`        | renderiza `TotalFlutuante` dentro do form quando `editavel` (+ casos em `apostas-da-rodada.spec`) |
| `_components/odds-com-valor.ts` (+spec)    | função pura do D-80                                                                               |
| `_components/odds-em-jogo.tsx` (+spec)     | seção da home                                                                                     |
| `page.tsx`                                 | acha a rodada aberta, lê cardápio e odds em paralelo, renderiza a seção acima da lista            |
| `docs/specs/titan-bet.md`                  | ponteiro para este arquivo                                                                        |

## 5. Server side e banco

Nenhum. Reusa `GET internal/titan-bet/rodadas`, `.../rodadas/:id` e `.../rodadas/:id/odds`,
todas atrás do `ApostadorDaRodadaGuard`. `oddsDaRodadaSchema` e os testes de contrato do
shared não mudam. Sem endpoint novo/alterado, a collection Yaak também não muda.

Custo aceito: a home faz mais duas leituras (cardápio e odds) quando há rodada aberta. Se
isso pesar, o caminho é um endpoint agregado — decisão futura, não desta entrega.

## 6. Matriz de testes (TDD: RED antes do código)

| ID    | Teste                                                                                                          | Onde                     |
| ----- | -------------------------------------------------------------------------------------------------------------- | ------------------------ |
| T-F01 | sem escolha, total 0 e 0 de M mercados                                                                         | `total-do-rascunho.spec` |
| T-F02 | soma só mercados com opção; ignora stake de mercado sem opção                                                  | idem                     |
| T-F03 | stake inválido (<200, >1000, vazio, decimal) fica fora da soma e conta em `stakesInvalidos`                    | idem                     |
| T-F04 | barra mostra o total em gold formatado e "N de M mercados"                                                     | `total-flutuante.spec`   |
| T-F05 | com `stakesInvalidos > 0`, avisa; com `alterado`, mostra "não salvo"                                           | idem                     |
| T-F06 | é `role="status"` (leitor de tela) e fixa em baixo (`sticky`)                                                  | idem                     |
| T-F07 | na tela: escolher opção soma o stake padrão; mudar stake atualiza; trocar de mercado soma                      | `apostas-da-rodada.spec` |
| T-F08 | rascunho salvo já abre com o total dele                                                                        | idem                     |
| T-F09 | tela não editável (fora do snapshot, rodada fechada, slip submetido): sem barra                                | idem                     |
| T-O01 | descarta `null`, resolve nomes de candidato e de boss da Weekly                                                | `odds-com-valor.spec`    |
| T-O02 | ordena por multiplicador decrescente; empate por nome e realm                                                  | idem                     |
| T-O03 | mercado sem opção com valor some; ordem dos mercados é a do cardápio                                           | idem                     |
| T-O04 | opção sem nome no cardápio é descartada                                                                        | idem                     |
| T-O05 | seção lista mercados e odds, com link para a rodada                                                            | `odds-em-jogo.spec`      |
| T-O06 | sem nenhuma odd com valor: estado vazio explícito                                                              | idem                     |
| T-B01 | navegador: `/interno/bet` mostra a seção com a ordem certa; `/interno/bet/:id` mostra a barra rolando a página | chrome-devtools (§7)     |

## 7. Validação no navegador

Sobe `pnpm dev`, entra na área interna, abre `/interno/bet` e a rodada aberta. Confere:
(a) a seção de odds em jogo, na ordem D-80b; (b) a barra flutuante visível com a página
rolada até o fim, somando a cada escolha; (c) largura de celular (~400px) sem rolagem
horizontal. Se não houver rodada aberta com apostas válidas no banco local, a validação
usa dados de desenvolvimento e registra o que foi possível.

## 8. Resultado (26/09/2026)

**TDD.** RED: 4 arquivos novos sem implementação e 4 testes de integração falhando; GREEN
com os 4 arquivos de código e a página. Um teste (T-F09) estava errado — `rerender` não
reinicia o `useState(slip)` — e foi corrigido no teste, não no código.

**Automatizado.** `pnpm format:check && pnpm build && pnpm lint && pnpm typecheck && pnpm test`:
verde. shared 417, web 270 (30 novos), api 998.

**Navegador** (banco local, `pnpm dev`, login real de officer, Chrome DevTools):

| Cenário                                                                           | Resultado                                    |
| --------------------------------------------------------------------------------- | -------------------------------------------- |
| Home sem slip válido: seção "Odds em jogo" com estado vazio                       | ok                                           |
| Slip novo: barra "0 gold · 0 de 6 mercados"                                       | ok                                           |
| Escolher opção, mudar stake, outro mercado: 200 → 750 gold, "2 de 6", "não salvo" | ok                                           |
| Barra visível com scroll em 0, 800, 1800 e no fim (`sticky`, colada na base)      | ok                                           |
| Stake 50: fora da soma, "1 stake fora de 200–1.000"                               | ok                                           |
| Salvar: "não salvo" some; Submeter: barra some (slip não editável)                | ok                                           |
| Confirmar depósito pelo officer; home lista só as 2 opções com aposta, sem "—"    | ok (0,90× cada — uma única aposta por opção) |
| 390 px: sem overflow horizontal na home e na rodada                               | ok                                           |
| Console e rede                                                                    | sem erro nem aviso; só 2xx                   |

**Não observado no navegador:** a ordenação decrescente com duas ou mais opções no mesmo
mercado (o banco local tem um único usuário; forjar um segundo por SQL contornaria
triggers e FKs) e a barra em 390 px (o slip de teste já estava submetido). Ambos estão
cobertos por teste automatizado (T-O02, T-F04–T-F06); a barra usa `flex-wrap`.

Dados de teste locais alterados: o slip aguardando depósito da rodada `teste-local-9001`
foi recusado pelo officer (motivo registrado) e outro slip foi criado, submetido e
confirmado (`valido`).
