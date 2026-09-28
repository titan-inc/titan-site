import { API_URL } from '../../../../lib/config';

/** O resultado de uma chamada do Officer Panel: o corpo, ou a recusa do Nest como veio. */
export type Chamada = { ok: true; corpo: unknown } | { ok: false; motivo: string };

/**
 * Chama uma rota do Officer Panel direto no Nest, com o cookie de sessão
 * (`credentials: 'include'`) — nunca por route handler do Next (Regra 1).
 *
 * A recusa volta com a mensagem do backend, sem tradução: é o `OfficerGuard` e
 * o service que decidem, e a mensagem deles é escrita para esta tela.
 */
export async function chamarOfficer(
  caminho: string,
  opcoes: { method?: 'POST' | 'PUT'; corpo?: unknown } = {},
): Promise<Chamada> {
  const url = `${API_URL}/internal/titan-bet/officer${caminho}`;
  try {
    const res = opcoes.method
      ? await fetch(url, {
          method: opcoes.method,
          credentials: 'include',
          ...(opcoes.corpo !== undefined
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(opcoes.corpo),
              }
            : {}),
        })
      : await fetch(url, { credentials: 'include', cache: 'no-store' });

    const corpo: unknown = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.ok) return { ok: true, corpo };

    const erro = corpo as { message?: unknown; issues?: Array<{ message: string }> } | null;
    if (erro?.issues?.[0]) return { ok: false, motivo: erro.issues[0].message };
    if (typeof erro?.message === 'string') return { ok: false, motivo: erro.message };
    return { ok: false, motivo: `Falhou (HTTP ${res.status})` };
  } catch {
    return { ok: false, motivo: 'Não foi possível falar com a API agora.' };
  }
}

export function Erro({ mensagem }: { mensagem: string | null }) {
  if (!mensagem) return null;
  return (
    <p role="alert" className="text-sm text-red-400">
      {mensagem}
    </p>
  );
}
