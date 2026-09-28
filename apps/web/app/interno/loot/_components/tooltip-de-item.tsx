import {
  BONUS_TERTIARIES,
  exibeValorDoTerciario,
  ITEM_STATS_INDISPONIVEL,
  PRIMARY_STATS,
  WOW_BONDINGS,
  type BonusTertiary,
  type ComputedItemSet,
  type ComputedItemStats,
  type ComputedStatPrimario,
  type ComputedStatSecundario,
  type ComputedStatTerciario,
  type DecodedTrack,
  type ItemStatsIndisponivel,
  type ItemView,
  type PrimaryStat,
  type WowBonding,
} from '@titan/shared';
import type { ReactNode } from 'react';
import { Dica } from '../../../_components/ui/dica';
import { urlDoIcone } from './icone-do-item';

/**
 * O tooltip de item — TIT-135, o conteúdo por cima do primitivo `Dica`.
 *
 * Recebe o dado por PROP, nunca busca: o `ComputedItemStats` já veio junto da
 * linha (`ItemView`), calculado em lote pelo Nest. Um endpoint sob demanda
 * chaveado por `itemId` perderia a variante — duas peças com o mesmo `itemId`
 * podem ter `itemString` diferente, e são coisas diferentes.
 *
 * Estrutura vira frase AQUI, nunca no payload — `ComputedItemStats` é
 * deliberadamente burro sobre o que a tela imprime.
 */
export function TooltipDeItem({
  item,
  trackScalingIdAtual,
  children,
}: {
  item: ItemView;
  /** `MAX(WowBonus.trackScalingId)` do build ativo. Regra 3 do tooltip: sem
   * ele (ou fora de sincronia com `item.track.scalingId`), a contagem `4/6`
   * não é impressa — só o nome da track. */
  trackScalingIdAtual: number | null;
  children: ReactNode;
}) {
  return (
    <Dica gatilho={children}>
      <ConteudoDoItem item={item} trackScalingIdAtual={trackScalingIdAtual} />
    </Dica>
  );
}

function ConteudoDoItem({
  item,
  trackScalingIdAtual,
}: {
  item: ItemView;
  trackScalingIdAtual: number | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Cabecalho item={item} />

      {item.indisponivel !== null && <Lacuna motivo={item.indisponivel} />}

      {item.itemLevel !== null && <p className="text-fg-muted">Item Level {item.itemLevel}</p>}

      <Track track={item.track} trackScalingIdAtual={trackScalingIdAtual} />
      {item.dificuldade !== null && <p className="text-fg-muted">{item.dificuldade}</p>}

      <Vinculo vinculo={item.vinculo} />

      <Primario primario={item.primario} />
      {item.armadura !== null && <p>{item.armadura} Armor</p>}
      {item.block !== null && <p>{item.block} Block</p>}
      <Secundarios lista={item.secundarios} />
      <Terciarios lista={item.terciarios} />
      {item.sockets > 0 && (
        <p className="text-fg-muted">
          {item.sockets} {item.sockets === 1 ? 'Socket' : 'Sockets'}
        </p>
      )}

      <Dano dano={item.dano} />
      {item.efeito !== null && <p className="text-fg-muted">{item.efeito.textoRenderizado}</p>}
      <Conjunto set={item.set} />

      {item.flavor !== null && <p className="text-fg-subtle italic">{item.flavor}</p>}

      {item.desconhecidos.length > 0 && (
        <p className="text-fg-subtle text-xs">
          {item.desconhecidos.length === 1
            ? '1 bônus não reconhecido'
            : `${item.desconhecidos.length} bônus não reconhecidos`}
        </p>
      )}
    </div>
  );
}

function Cabecalho({ item }: { item: ItemView }) {
  return (
    <header className="flex items-center gap-2">
      {item.icon !== null && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={urlDoIcone(item.icon)} alt="" width={24} height={24} className="rounded" />
      )}
      <div>
        <p className={item.name !== null ? 'font-medium' : 'text-fg-subtle italic'}>
          {item.name ?? `Item ${item.itemId}`}
        </p>
        {item.itemSubclass !== null && (
          <p className="text-fg-subtle text-xs">{item.itemSubclass}</p>
        )}
      </div>
    </header>
  );
}

/**
 * Regra 3 — a contagem `rank/de` só sai se `track.scalingId` for a season
 * CORRENTE do build ativo. `scalingId` cru comparado com
 * `trackScalingIdAtual` — nunca impresso por chute: sem os dois números,
 * mostra só o nome.
 */
function Track({
  track,
  trackScalingIdAtual,
}: {
  track: DecodedTrack | null;
  trackScalingIdAtual: number | null;
}) {
  if (track === null) return null;

  const contagemAtual = trackScalingIdAtual !== null && track.scalingId === trackScalingIdAtual;

  return (
    <p className="text-fg-muted">
      {contagemAtual ? `${track.nome} ${track.rank}/${track.de}` : track.nome}
    </p>
  );
}

/** Regra 1 — `exibeValorDoTerciario()` decide, nunca reimplementado aqui. */
function Terciarios({ lista }: { lista: ComputedStatTerciario[] }) {
  if (lista.length === 0) return null;
  return (
    <>
      {lista.map((t) => (
        <p key={t.tipo}>
          {exibeValorDoTerciario(t.tipo)
            ? `+${t.valor} ${ROTULO_TERCIARIO[t.tipo]}`
            : ROTULO_TERCIARIO[t.tipo]}
        </p>
      ))}
    </>
  );
}

/**
 * Regra 2 — `pecasTotal` sem numerador. A contagem `(4/5)` não existe sem
 * personagem, e o numerador nunca aparece como zero.
 */
function Conjunto({ set }: { set: ComputedItemSet | null }) {
  if (set === null) return null;
  return (
    <div className="text-fg-muted">
      <p>
        {set.nome} ({set.pecasTotal}-Piece Set)
      </p>
      {/* Sem personagem, o jogo mostra sempre esta linha genérica — não é o
          que ITEM_SET_BONUS_NO_VALID_SPEC resolveria com spec escolhida, mas
          é o que o tooltip padrão mostra (ver docs/db2-do-cliente.md). */}
      <p className="text-xs italic">Bonus effects vary based on the player&apos;s specialization</p>
    </div>
  );
}

/**
 * Regra 4 — `primario.tipos` é array (primário flexível mostra os três).
 * `primario: null` com `secundarios` cheio não é erro (`Bubblefin Splash
 * Guard`): os dois candidatos já estão em `secundarios`, sem destaque.
 */
function Primario({ primario }: { primario: ComputedStatPrimario | null }) {
  if (primario === null) return null;
  return (
    <p>
      +{primario.valor} {primario.tipos.map((t) => ROTULO_PRIMARIO[t]).join('/')}
    </p>
  );
}

function Secundarios({ lista }: { lista: ComputedStatSecundario[] }) {
  if (lista.length === 0) return null;
  return (
    <>
      {lista.map((s) => (
        <p key={s.nome}>
          +{s.valor} {ROTULO_SECUNDARIO[s.nome]}
        </p>
      ))}
    </>
  );
}

function Dano({ dano }: { dano: ComputedItemStats['dano'] }) {
  if (dano === null) return null;
  return (
    <div>
      <p>
        {dano.min} - {dano.max} Damage
      </p>
      <p className="text-fg-muted">
        Speed {dano.velocidade.toFixed(1)}
        <span className="text-fg-subtle"> ({dano.dps.toFixed(1)} damage per second)</span>
      </p>
    </div>
  );
}

/**
 * Regra 5 — "Binds to…", nunca "…bound". `warband` (bit 27 do Flags) e
 * `warbound_until_equipped` (Type 46 do bônus) são fenômenos DIFERENTES —
 * ver `resolverVinculo` e o comentário de `WOW_BONDINGS` — com frases
 * diferentes; colapsar os dois na mesma frase erraria um dos dois
 * espécimes verificados. Nulo é lacuna, e a linha aparece mesmo assim.
 */
function Vinculo({ vinculo }: { vinculo: WowBonding | null }) {
  return (
    <p className="text-fg-muted">
      {vinculo === null ? 'Vínculo desconhecido' : ROTULO_VINCULO[vinculo]}
    </p>
  );
}

function Lacuna({ motivo }: { motivo: ItemStatsIndisponivel }) {
  return <p className="text-danger text-xs">{ROTULO_INDISPONIVEL[motivo]}</p>;
}

/* -------------------------------------------------------------------------- */
/* Rótulos — a mesma palavra que o cliente do WoW mostra, em inglês de        */
/* propósito: é o vocabulário do jogo, não da interface do site.              */
/* -------------------------------------------------------------------------- */

const ROTULO_PRIMARIO: Record<PrimaryStat, string> = {
  [PRIMARY_STATS.STRENGTH]: 'Strength',
  [PRIMARY_STATS.AGILITY]: 'Agility',
  [PRIMARY_STATS.INTELLECT]: 'Intellect',
};

const ROTULO_SECUNDARIO: Record<ComputedStatSecundario['nome'], string> = {
  agility: 'Agility',
  strength: 'Strength',
  intellect: 'Intellect',
  stamina: 'Stamina',
  crit: 'Critical Strike',
  haste: 'Haste',
  versatility: 'Versatility',
  mastery: 'Mastery',
};

const ROTULO_TERCIARIO: Record<BonusTertiary, string> = {
  [BONUS_TERTIARIES.AVOIDANCE]: 'Avoidance',
  [BONUS_TERTIARIES.LEECH]: 'Leech',
  [BONUS_TERTIARIES.SPEED]: 'Speed',
  [BONUS_TERTIARIES.INDESTRUCTIBLE]: 'Indestructible',
};

/**
 * `warband` e `warbound_until_equipped` são medidos separadamente (ver o
 * comentário de `resolverVinculo` no shared) e têm frases diferentes —
 * "Binds to Warband" contra "Binds to Warband until equipped".
 */
const ROTULO_VINCULO: Record<WowBonding, string> = {
  [WOW_BONDINGS.BIND_ON_PICKUP]: 'Binds when picked up',
  [WOW_BONDINGS.BIND_ON_EQUIP]: 'Binds when equipped',
  [WOW_BONDINGS.WARBAND]: 'Binds to Warband',
  [WOW_BONDINGS.WARBOUND_UNTIL_EQUIPPED]: 'Binds to Warband until equipped',
};

const ROTULO_INDISPONIVEL: Record<ItemStatsIndisponivel, string> = {
  [ITEM_STATS_INDISPONIVEL.ITEM_STRING_INVALIDO]: 'Não deu para ler este item.',
  [ITEM_STATS_INDISPONIVEL.SEM_BUILD_ATIVO]: 'Nenhum pacote de dados do cliente está ativo.',
  [ITEM_STATS_INDISPONIVEL.ITEM_FORA_DO_BUILD]: 'Este item não está no pacote de dados carregado.',
  [ITEM_STATS_INDISPONIVEL.SEM_ESCALA_PARA_ILVL]:
    'Sem escala para calcular os números deste nível de item.',
};
