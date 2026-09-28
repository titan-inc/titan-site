'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { API_URL } from '../../../lib/config';
import { ModalErroLogin } from './modal-erro-login';

/**
 * Mostra o modal de erro quando o motivo chega por querystring.
 *
 * Dois caminhos chegam aqui, e desde a TIT-148 os dois são navegação de página
 * inteira — não existe mais aviso entre janelas:
 *
 * - o proxy e as páginas internas mandam quem não tem sessão para `/?erro=sessao`;
 * - o OAuth volta da Blizzard em `/?erro=cancelado|state|falha`.
 *
 * Logout não manda erro nenhum, e por isso não abre nada.
 *
 * **Instância única, montada no `SiteShell`.** É o único lugar que lê a URL: o
 * `LoginButton` aparece duas vezes na navbar (desktop e compacto), e um modal
 * dentro dele abriria duas vezes, uma delas dentro de um `display: none`.
 */
export function ErroLoginNaUrl() {
  const router = useRouter();
  const busca = useSearchParams();

  // Capturados na primeira renderização, não dentro do efeito: o efeito limpa a
  // URL logo em seguida, e ler de lá depois devolveria `null`. Também evita
  // `setState` síncrono em efeito, que dispara renderização em cascata.
  const [motivo] = useState(() => busca.get('erro'));
  const [de] = useState(() => busca.get('de'));
  const [fechado, setFechado] = useState(false);

  // Limpar a URL é sincronizar sistema externo, não derivar estado: sem isso o
  // erro volta a cada refresh e viaja junto em link compartilhado.
  useEffect(() => {
    if (motivo) router.replace(window.location.pathname, { scroll: false });
  }, [motivo, router]);

  // `de` é o caminho de onde a pessoa foi mandada embora, e é para lá que
  // "tentar de novo" tem que devolver — é o único ponto do site que sabe disso,
  // porque o proxy acabou de pôr na URL. O Nest revalida antes de usar
  // (`destinoSeguro`); daqui sai como parâmetro, não como promessa.
  const inicio = `${API_URL}/auth/battlenet${de ? `?de=${encodeURIComponent(de)}` : ''}`;

  return (
    <ModalErroLogin
      motivo={fechado ? null : motivo}
      aoFechar={() => setFechado(true)}
      aoTentar={() => {
        window.location.href = inicio;
      }}
    />
  );
}
