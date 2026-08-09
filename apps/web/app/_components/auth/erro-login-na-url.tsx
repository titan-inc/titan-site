'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { API_URL } from '../../../lib/config';
import { ModalErroLogin } from './modal-erro-login';

/**
 * Mostra o modal de erro quando o motivo chega por querystring.
 *
 * Três caminhos chegam aqui, e nenhum passa por `postMessage`:
 *
 * - o proxy e as páginas internas mandam quem não tem sessão para `/?erro=sessao`;
 * - o OAuth de página inteira — popup bloqueado ou sem JavaScript — volta da
 *   Blizzard em `/?erro=cancelado|state|falha`;
 * - logout não manda erro nenhum, e por isso não abre nada.
 *
 * Antes isso era a página `/entrar`. Agora a home é o único lugar de login e o
 * erro aparece no mesmo modal do fluxo de popup, sem navegar.
 *
 * **Instância única, montada no `SiteShell`.** O `LoginButton` aparece duas
 * vezes na navbar (desktop e compacto) e tem o seu próprio modal para o fluxo
 * de popup — se a leitura da URL morasse nele, os dois abririam modal ao mesmo
 * tempo, e o da variante escondida abriria dentro de um `display: none`.
 */
export function ErroLoginNaUrl() {
  const router = useRouter();
  const busca = useSearchParams();

  // Capturado na primeira renderização, não dentro do efeito: o efeito limpa a
  // URL logo em seguida, e ler de lá depois devolveria `null`. Também evita
  // `setState` síncrono em efeito, que dispara renderização em cascata.
  const [motivo] = useState(() => busca.get('erro'));
  const [fechado, setFechado] = useState(false);

  // Limpar a URL é sincronizar sistema externo, não derivar estado: sem isso o
  // erro volta a cada refresh e viaja junto em link compartilhado.
  useEffect(() => {
    if (motivo) router.replace(window.location.pathname, { scroll: false });
  }, [motivo, router]);

  return (
    <ModalErroLogin
      motivo={fechado ? null : motivo}
      aoFechar={() => setFechado(true)}
      // Página inteira, não popup: quem chega por aqui ou está sem sessão ou já
      // falhou num fluxo que o popup não resolveu.
      aoTentar={() => {
        window.location.href = `${API_URL}/auth/battlenet`;
      }}
    />
  );
}
