import type { MessageEvent } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { LootSessionChangeBus } from './loot-session-change-bus';

/**
 * Coleta os avisos ("mudou") emitidos por um stream, em ordem. Saudação
 * (`ola`) e heartbeat ficam de fora — outros testes olham para eles.
 */
function coletarAvisos(bus: LootSessionChangeBus, sessionId: string) {
  const avisos: number[] = [];
  const sub = bus.abrirStream(sessionId).subscribe((evento: MessageEvent) => {
    if (evento.data === 'mudou') avisos.push(Date.now());
  });
  return { avisos, sub };
}

/**
 * O `Map` de canais é privado de propósito — não há razão de negócio para
 * expô-lo. Mas "não deixa nada pendurado" só é uma afirmação verificável
 * olhando pra dentro dele, e é exatamente o que um teste anterior prometia
 * no nome e não checava na asserção.
 */
function tamanhoDoMapaDeCanais(bus: LootSessionChangeBus): number {
  return (bus as unknown as { canais: Map<string, unknown> }).canais.size;
}

describe('LootSessionChangeBus', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Nenhuma env de throttle/jitter setada no ambiente de teste — os
    // testes assumem o default do schema (throttle 1000ms, jitter 300ms).
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a primeira conexão recebe a saudação com o jitter, antes de qualquer aviso', () => {
    const bus = new LootSessionChangeBus();
    const eventos: MessageEvent[] = [];
    const sub = bus.abrirStream('sess-1').subscribe((e) => eventos.push(e));

    expect(eventos).toEqual([{ type: 'ola', data: { jitterMs: 300 } }]);
    sub.unsubscribe();
  });

  it('emite na borda de subida — reação imediata ao primeiro aviso', () => {
    const bus = new LootSessionChangeBus();
    const { avisos, sub } = coletarAvisos(bus, 'sess-1');

    bus.avisar('sess-1');

    // Síncrono: throttleTime emite a borda de subida sem precisar de tick de
    // relógio nenhum.
    expect(avisos.length).toBe(1);
    sub.unsubscribe();
  });

  it('consolida uma rajada dentro da janela: só a borda de subida e a de descida', () => {
    const bus = new LootSessionChangeBus(); // throttle default: 1000ms
    const { avisos, sub } = coletarAvisos(bus, 'sess-1');

    bus.avisar('sess-1'); // t=0: leading, emite na hora
    jest.advanceTimersByTime(100);
    bus.avisar('sess-1'); // t=100: dentro da janela, engolido por enquanto
    jest.advanceTimersByTime(100);
    bus.avisar('sess-1'); // t=200: idem — é ESTE que precisa sobreviver
    expect(avisos.length).toBe(1);

    jest.advanceTimersByTime(700); // t=900: janela ainda não fechou
    expect(avisos.length).toBe(1);

    jest.advanceTimersByTime(100); // t=1000: janela fecha
    // A emissão de fechamento é obrigatória: sem ela, a resposta de t=200
    // ficaria engolida até alguém dar F5 — exatamente o que um debounce
    // faria e o throttle com trailing:true não pode fazer.
    expect(avisos.length).toBe(2);

    jest.advanceTimersByTime(5000); // silêncio total depois — nada mais emite
    expect(avisos.length).toBe(2);

    sub.unsubscribe();
  });

  it('300 eventos em 3 segundos produzem poucos avisos, nunca um por evento', () => {
    const bus = new LootSessionChangeBus();
    const { avisos, sub } = coletarAvisos(bus, 'sess-1');

    for (let i = 0; i < 300; i++) {
      bus.avisar('sess-1');
      jest.advanceTimersByTime(10); // 300 × 10ms = 3000ms de rajada contínua
    }
    jest.advanceTimersByTime(1000); // deixa a última janela fechar

    // Uma rajada contínua de 3s com throttle de 1000ms fecha ~3-4 janelas
    // (borda de subida em t=0, e uma emissão a cada fechamento de janela
    // enquanto o evento continuar chegando) — MUITO longe de 300.
    expect(avisos.length).toBeGreaterThan(0);
    expect(avisos.length).toBeLessThanOrEqual(4);

    sub.unsubscribe();
  });

  it('um aviso isolado depois do silêncio é anunciado na hora — não fica preso a uma janela velha', () => {
    const bus = new LootSessionChangeBus();
    const { avisos, sub } = coletarAvisos(bus, 'sess-1');

    bus.avisar('sess-1'); // t=0: leading
    jest.advanceTimersByTime(2000); // silêncio bem além da janela: throttle relaxa

    bus.avisar('sess-1'); // isolado, sem rajada nenhuma por trás
    expect(avisos.length).toBe(2);

    sub.unsubscribe();
  });

  it('consolida por SESSÃO: duas sessões não interferem uma na outra', () => {
    const bus = new LootSessionChangeBus();
    const a = coletarAvisos(bus, 'sess-a');
    const b = coletarAvisos(bus, 'sess-b');

    bus.avisar('sess-a');
    expect(a.avisos.length).toBe(1);
    expect(b.avisos.length).toBe(0);

    bus.avisar('sess-b');
    expect(b.avisos.length).toBe(1);

    a.sub.unsubscribe();
    b.sub.unsubscribe();
  });

  it('consolida por sessão, não por conexão: duas conexões da MESMA sessão recebem os MESMOS avisos', () => {
    const bus = new LootSessionChangeBus();
    const primeira = coletarAvisos(bus, 'sess-1');
    const segunda = coletarAvisos(bus, 'sess-1');

    bus.avisar('sess-1');
    jest.advanceTimersByTime(100);
    bus.avisar('sess-1');
    jest.advanceTimersByTime(1000);

    // Se cada conexão tivesse o seu PRÓPRIO throttleTime, as duas ainda
    // bateriam no mesmo número aqui (a entrada é idêntica) — o que este
    // teste garante é que é a MESMA emissão fanned-out, não duas
    // computações paralelas. `avisar()` sem assinante nenhum (teste
    // seguinte) é o que desambiguaria, mas aqui já cravamos a contagem.
    expect(primeira.avisos).toEqual(segunda.avisos);
    expect(primeira.avisos.length).toBe(2);

    primeira.sub.unsubscribe();
    segunda.sub.unsubscribe();
  });

  it('sem ninguém ouvindo, avisar() é no-op e não deixa entrada pendurada no Map', () => {
    // É o caminho NORMAL, não borda: criar() chama avisar() no instante em
    // que a sessão nasce, antes de qualquer cliente poder estar conectado.
    const bus = new LootSessionChangeBus();

    expect(() => bus.avisar('sess-sem-ouvinte')).not.toThrow();
    expect(tamanhoDoMapaDeCanais(bus)).toBe(0);
  });

  it('avisar() em muitas sessões sem ouvinte nenhum não acumula no Map', () => {
    const bus = new LootSessionChangeBus();

    for (let i = 0; i < 50; i++) bus.avisar(`sess-${i}`);

    expect(tamanhoDoMapaDeCanais(bus)).toBe(0);
  });

  it('depois que o último assinante sai, o estado de throttle reseta', () => {
    const bus = new LootSessionChangeBus();

    const primeira = coletarAvisos(bus, 'sess-1');
    bus.avisar('sess-1');
    expect(primeira.avisos.length).toBe(1); // leading imediato
    primeira.sub.unsubscribe();

    // Ninguém mais ouvindo. Se o canal antigo sobrevivesse, esta segunda
    // conexão herdaria uma janela de throttle a meio caminho.
    const segunda = coletarAvisos(bus, 'sess-1');
    bus.avisar('sess-1');

    // Nova borda de subida, imediata — prova que o canal é novo em folha.
    expect(segunda.avisos.length).toBe(1);
    segunda.sub.unsubscribe();
  });

  describe('vida útil da conexão — ~15 minutos, com jitter de ±15%', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('termina sozinha no pior caso do jitter (-15%)', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);
      const bus = new LootSessionChangeBus();
      let completou = false;
      const sub: Subscription = bus.abrirStream('sess-1').subscribe({
        complete: () => (completou = true),
      });

      const menorVida = 15 * 60 * 1000 * 0.85;
      jest.advanceTimersByTime(menorVida - 1);
      expect(completou).toBe(false);

      jest.advanceTimersByTime(1);
      expect(completou).toBe(true);

      sub.unsubscribe();
    });

    it('termina sozinha no maior caso do jitter (+15%)', () => {
      jest.spyOn(Math, 'random').mockReturnValue(1);
      const bus = new LootSessionChangeBus();
      let completou = false;
      const sub: Subscription = bus.abrirStream('sess-1').subscribe({
        complete: () => (completou = true),
      });

      const maiorVida = 15 * 60 * 1000 * 1.15;
      jest.advanceTimersByTime(maiorVida - 1);
      expect(completou).toBe(false);

      jest.advanceTimersByTime(1);
      expect(completou).toBe(true);

      sub.unsubscribe();
    });

    it('espalha a vida útil entre DUAS conexões da mesma sessão — reconexão não sincroniza', () => {
      // Sem isto, ~25 raiders que abrem a tela no mesmo par de minutos teriam
      // conexões expirando e reconectando juntas a cada STREAM_LIFETIME_MS —
      // o mesmo pico sincronizado que motivou o jitter do router.refresh().
      const sorteios = [0, 1];
      let i = 0;
      jest.spyOn(Math, 'random').mockImplementation(() => sorteios[i++ % sorteios.length] ?? 0);

      const bus = new LootSessionChangeBus();
      let primeiraCompletou = false;
      let segundaCompletou = false;
      const primeira = bus.abrirStream('sess-1').subscribe({
        complete: () => (primeiraCompletou = true),
      });
      const segunda = bus.abrirStream('sess-1').subscribe({
        complete: () => (segundaCompletou = true),
      });

      // A menor vida útil possível (-15%, sorteada pela primeira conexão) já
      // passou; a maior (+15%, da segunda) ainda não.
      jest.advanceTimersByTime(15 * 60 * 1000 * 0.85);
      expect(primeiraCompletou).toBe(true);
      expect(segundaCompletou).toBe(false);

      primeira.unsubscribe();
      segunda.unsubscribe();
    });
  });

  it('manda um heartbeat a cada ~30s, sem payload — não deve acordar onmessage', () => {
    const bus = new LootSessionChangeBus();
    const eventos: MessageEvent[] = [];
    const sub = bus.abrirStream('sess-1').subscribe((e) => eventos.push(e));

    jest.advanceTimersByTime(30_000);

    const heartbeats = eventos.filter((e) => e.type === 'heartbeat');
    expect(heartbeats.length).toBe(1);
    // Vazio de propósito — ver o comentário de HEARTBEAT_INTERVAL_MS no
    // arquivo de origem: sem `data:` na fiação, o browser nem dispara
    // onmessage para isto.
    expect(heartbeats[0]?.data).toBe('');

    sub.unsubscribe();
  });
});
