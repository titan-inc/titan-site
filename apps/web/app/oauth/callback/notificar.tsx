'use client';
import { useEffect } from 'react';
import { CANAL_LOGIN, type AvisoLogin } from '../../../lib/auth/canal';

/**
 * Avisa a janela mãe e fecha o popup.
 *
 * Duas correções da TIT-144 moram aqui:
 *
 * - o aviso vai por `BroadcastChannel`, não por `window.opener.postMessage`.
 *   O canal não depende de a mãe ainda ser alcançável por referência;
 * - `close()` é tentado SEMPRE, não só quando existe `opener`. Antes, popup sem
 *   opener ficava aberto para sempre mostrando "pode fechar esta janela".
 *
 * O `close()` pode ser recusado pelo navegador quando a janela não foi aberta
 * por script — e aí a página continua legível, com o texto e os links que
 * `page.tsx` já renderiza. É o caminho de quem caiu aqui numa aba normal.
 */
export function NotificarOAuth({ status, motivo }: { status: 'ok' | 'erro'; motivo?: string }) {
  useEffect(() => {
    const aviso: AvisoLogin = { tipo: 'titan-oauth', status, motivo };

    // Um canal por montagem, fechado no cleanup: canal vazado segura o popup
    // vivo em navegador que espera todos fecharem antes de descarregar.
    let canal: BroadcastChannel | null = null;
    try {
      canal = new BroadcastChannel(CANAL_LOGIN);
      canal.postMessage(aviso);
    } catch {
      // Sem BroadcastChannel (browser antigo, contexto restrito) o polling da
      // mãe resolve sozinho. Não é motivo para quebrar esta página.
    }

    // Depois do aviso, e num tick separado: fechar antes de o canal entregar
    // é a corrida que derrubava o postMessage — o remetente sumia primeiro.
    const id = window.setTimeout(() => {
      try {
        window.close();
      } catch {
        // Recusado pelo navegador. A página já diz o que fazer.
      }
    }, 0);

    return () => {
      window.clearTimeout(id);
      canal?.close();
    };
  }, [status, motivo]);

  return null;
}
