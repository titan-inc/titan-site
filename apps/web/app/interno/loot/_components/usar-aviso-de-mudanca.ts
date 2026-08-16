import { useEffect, useRef } from 'react';
import { API_URL } from '../../../../lib/config';

/**
 * Assina o aviso de mudança da sessão (SSE, TIT-68) e chama `aoMudar` quando o
 * servidor avisa que algo mudou.
 *
 * O stream carrega AVISO, nunca dado: este hook nunca lê o `data` do evento
 * de mudança, só reage a ele — quem busca o estado de verdade é o
 * `router.refresh()` que `aoMudar` já chama. Reconexão é do `EventSource`;
 * não há nada para perder ou duplicar porque não há evento com conteúdo.
 *
 * O jitter chega pelo PRIMEIRO evento do stream (`ola`), nunca de env
 * `NEXT_PUBLIC_*` — o browser não tem nenhum número de tempo próprio, e quem
 * decide é sempre o servidor.
 */
export function useAvisoDeMudanca(sessionId: string, aoMudar: () => void): void {
  // Em ref para não recriar a conexão a cada render só porque o chamador
  // passou uma arrow function nova — o efeito de baixo reabre só quando a
  // SESSÃO muda. A escrita mora no seu PRÓPRIO efeito, e não direto no corpo
  // da função: mexer em ref durante o render é o que o React 19 proíbe.
  const aoMudarRef = useRef(aoMudar);
  useEffect(() => {
    aoMudarRef.current = aoMudar;
  }, [aoMudar]);

  useEffect(() => {
    let jitterMs = 0;
    const pendentes = new Set<ReturnType<typeof setTimeout>>();

    // withCredentials: sem isso o cookie de sessão não atravessa, e o
    // MemberGuard recusa a conexão — mesma exigência do fetch com
    // credentials: 'include' no resto do app (ver logout-button).
    const origem = new EventSource(`${API_URL}/internal/loot-sessions/${sessionId}/mudancas`, {
      withCredentials: true,
    });

    origem.addEventListener('ola', (evento) => {
      try {
        const dados = JSON.parse((evento as MessageEvent).data) as { jitterMs: number };
        jitterMs = dados.jitterMs;
      } catch {
        // Saudação corrompida: fica em 0 (reação imediata) em vez de deixar
        // a exceção matar este listener — é config de espalhamento, não algo
        // que deva travar a tela reagindo.
      }
    });

    // Evento sem `type` (o aviso de mudança em si) cai aqui.
    origem.onmessage = () => {
      const atraso = Math.random() * jitterMs;
      const id = setTimeout(() => {
        pendentes.delete(id);
        aoMudarRef.current();
      }, atraso);
      pendentes.add(id);
    };

    return () => {
      origem.close();
      for (const id of pendentes) clearTimeout(id);
    };
  }, [sessionId]);
}
