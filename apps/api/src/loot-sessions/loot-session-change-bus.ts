import { Injectable } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import {
  asyncScheduler,
  finalize,
  map,
  merge,
  Observable,
  of,
  share,
  Subject,
  takeUntil,
  throttleTime,
  timer,
} from 'rxjs';
import { loadLootSessionRealtimeConfig } from '../config/loot-session-realtime.config';

/**
 * A cada ~30s, um evento com `data` **vazio** — o `MessageEvent` do Nest
 * exige o campo, mas o `_transform` do SSE só escreve a linha `data:` quando
 * ele é truthy (`''` não é), então isto vira só `event: heartbeat\nid: N\n\n`
 * na fiação. Pela spec de SSE, sem `data:` o buffer de evento fica vazio e o
 * browser NÃO dispara `onmessage` — mas os bytes chegaram, e é isso que evita
 * que um proxy no meio do caminho derrube uma conexão que pareceria ociosa.
 *
 * A issue pede um comentário SSE cru (`: heartbeat`), mas o `@Sse()` do Nest
 * não expõe essa linha — o `MessageEvent` só tem `data`/`type`/`id`/`retry`
 * (ver `sse-stream.js`). Este evento chega ao mesmo efeito prático sem sair
 * da API pública do decorator.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Ver o comentário de `HEARTBEAT_INTERVAL_MS`: vazio de propósito. */
const HEARTBEAT: MessageEvent = { type: 'heartbeat', data: '' };

/**
 * Vida útil de UMA conexão SSE. Ao expirar, o Observable completa, o Nest
 * fecha a resposta, e o `EventSource` do browser reconecta sozinho — que é o
 * que roda o `MemberGuard` de novo e dá teto ao atraso de uma revogação de
 * membership.
 */
const STREAM_LIFETIME_MS = 15 * 60 * 1000;

/**
 * A vida útil de UMA conexão, com jitter (±15%) resolvido na hora que ela
 * abre — sem isto, ~25 raiders que abrem a tela no mesmo par de minutos
 * (todo mundo depois do boss cair) teriam conexões expirando juntas e
 * reconectando juntas a cada `STREAM_LIFETIME_MS`: o mesmo pico sincronizado
 * que motivou o jitter do `router.refresh()`, só que na vida útil do stream
 * em vez do refetch.
 *
 * Por CONEXÃO, não por sessão: cada `EventSource` resolve o seu, então nem
 * duas abas da MESMA pessoa expiram juntas.
 */
function vidaUtilComJitter(): number {
  return STREAM_LIFETIME_MS * (0.85 + Math.random() * 0.3);
}

/** Uma sessão, e mais nada — nenhum payload. */
const AVISO: MessageEvent = { data: 'mudou' };

/**
 * O canal de uma sessão: a entrada crua (`avisar` escreve aqui) e a saída já
 * throttled e compartilhada (toda conexão desta sessão assina a MESMA
 * `saida`).
 *
 * As duas guardadas juntas, e memoizadas UMA VEZ por sessão, é o que faz o
 * `share()` valer: se `saida` fosse recriada a cada conexão, cada uma teria o
 * seu próprio `throttleTime` correndo em paralelo sobre a mesma entrada — o
 * throttle deixaria de ser "uma vez por sessão" e viraria "uma vez por
 * conexão", exatamente o que a issue pede para NÃO acontecer.
 */
interface CanalDaSessao {
  entrada: Subject<void>;
  saida: Observable<void>;
}

/**
 * O aviso de "a sessão X mudou", consolidado no servidor — TIT-68.
 *
 * Um canal por sessão, throttled e compartilhado (`share()`) entre TODAS as
 * conexões daquela sessão: o `throttleTime` roda UMA VEZ por sessão, não uma
 * vez por cliente conectado. É o que a issue exige — sem isso, 25 conexões
 * recalculariam o mesmo throttle 25 vezes, e "consolidar no servidor" seria
 * só um nome; o resultado que importa é que TODOS os clientes recebem
 * exatamente os mesmos avisos, na mesma hora.
 *
 * `leading: true, trailing: true`: a borda de subida garante reação imediata
 * ao primeiro evento da rajada, e a de descida (`trailing`) garante que o
 * ÚLTIMO evento — a resposta de quem respondeu por último — não fica
 * engolido dentro da janela.
 */
@Injectable()
export class LootSessionChangeBus {
  private readonly config = loadLootSessionRealtimeConfig();
  private readonly canais = new Map<string, CanalDaSessao>();

  /** O jitter chega ao browser por aqui — nunca por env `NEXT_PUBLIC_*`. */
  get jitterMs(): number {
    return this.config.jitterMs;
  }

  /**
   * Alguma coisa desta sessão mudou.
   *
   * SEM CRIAR canal: se ninguém está com o stream aberto, é no-op — dica sem
   * destinatário não tem por que existir. `criar()` avisa no instante em que
   * a sessão nasce, antes de qualquer cliente poder estar conectado, e o
   * mesmo vale para qualquer escrita feita enquanto ninguém tem a tela
   * aberta; se isto criasse o canal, TODA sessão deixaria uma entrada
   * permanente no `Map`, porque o `finalize()` que libera só dispara depois
   * de alguém ter assinado. Quem conectar depois de qualquer forma renderiza
   * o estado atual pelo server component — `abrirStream()` é quem cria o
   * canal, na hora que alguém de fato assina.
   *
   * Chamar SEMPRE depois que a escrita comitou — nunca de dentro da
   * transação. Publicado antes, quem receber o aviso rebusca e lê o estado
   * velho, e não vem segundo aviso: fica desatualizado para sempre.
   * Publicado depois, o pior caso é um refetch à toa.
   */
  avisar(sessionId: string): void {
    this.canais.get(sessionId)?.entrada.next();
  }

  /**
   * O stream SSE completo desta sessão: a saudação com o jitter, o aviso
   * throttled, e o heartbeat — tudo numa conexão com vida útil limitada.
   */
  abrirStream(sessionId: string): Observable<MessageEvent> {
    const saudacao = of<MessageEvent>({ type: 'ola', data: { jitterMs: this.jitterMs } });

    const heartbeat = timer(HEARTBEAT_INTERVAL_MS, HEARTBEAT_INTERVAL_MS).pipe(
      map((): MessageEvent => HEARTBEAT),
    );

    const mudou = this.canalDe(sessionId).saida.pipe(map((): MessageEvent => AVISO));

    return merge(saudacao, heartbeat, mudou).pipe(takeUntil(timer(vidaUtilComJitter())));
  }

  private canalDe(sessionId: string): CanalDaSessao {
    const existente = this.canais.get(sessionId);
    if (existente) return existente;

    const entrada = new Subject<void>();
    const saida = entrada.pipe(
      throttleTime(this.config.throttleMs, asyncScheduler, { leading: true, trailing: true }),
      // Dentro do share(): dispara quando o ÚLTIMO assinante externo sai, não
      // a cada um. É o que libera a entrada do Map — sem ninguém ouvindo, o
      // estado de throttle não serve para nada, e a próxima conexão começa
      // um canal novo em folha.
      finalize(() => this.canais.delete(sessionId)),
      share(),
    );

    const canal: CanalDaSessao = { entrada, saida };
    this.canais.set(sessionId, canal);
    return canal;
  }
}
