'use client';

import { officerListSchema, type OfficerGrant, type OfficerList } from '@titan/shared';
import { useState, useTransition } from 'react';
import { API_URL } from '../../../../lib/config';

/**
 * Quem é oficial, nas duas fontes — e a concessão/revogação da fonte manual.
 *
 * Escreve direto na API do Nest (`credentials: 'include'` leva o cookie), não
 * por route handler do Next — Regra 1: route handler é para o que é do browser,
 * e isto é regra de negócio com guard próprio.
 *
 * A API devolve a lista inteira depois de cada mutação, então o estado da tela
 * é sempre o que o banco acabou de confirmar. Atualizar otimista aqui mostraria
 * como concedido um grant que o servidor pode ter recusado — e a concessão
 * costuma ser feita com a pessoa esperando do outro lado do Discord.
 */
export function GestaoOficiais({ inicial }: { inicial: OfficerList }) {
  const [lista, setLista] = useState(inicial);
  const { grants, byRank, officerRankMax, rosterOk } = lista;
  const [nome, setNome] = useState('');
  const [realm, setRealm] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  /** Aplica a lista devolvida pela API. Erro do servidor vira mensagem na tela. */
  async function enviar(url: string, init: RequestInit) {
    setErro(null);

    const res = await fetch(url, { credentials: 'include', ...init });

    if (!res.ok) {
      // A API manda mensagem em português pensada para esta tela ("não está no
      // roster", "é o último oficial"). Mostrar ela é melhor que um HTTP 409.
      const corpo: unknown = await res.json().catch(() => null);
      const message =
        corpo && typeof corpo === 'object' && 'message' in corpo
          ? String((corpo as { message: unknown }).message)
          : `Falhou (HTTP ${res.status})`;
      throw new Error(message);
    }

    const parsed = officerListSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error('Resposta inesperada da API');

    setLista(parsed.data);
  }

  function conceder(e: React.FormEvent) {
    e.preventDefault();

    startTransition(async () => {
      try {
        await enviar(`${API_URL}/internal/officers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nome.trim(), realm: realm.trim() }),
        });
        setNome('');
        setRealm('');
      } catch (err) {
        setErro(err instanceof Error ? err.message : 'Não foi possível conceder');
      }
    });
  }

  function revogar(grant: OfficerGrant) {
    startTransition(async () => {
      try {
        await enviar(`${API_URL}/internal/officers/${grant.id}`, { method: 'DELETE' });
      } catch (err) {
        setErro(err instanceof Error ? err.message : 'Não foi possível revogar');
      }
    });
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-fg text-lg font-semibold tracking-tight">Pelo rank na guilda</h2>
          <p className="text-fg-muted mt-1 text-sm">
            Todo personagem de rank 0 a {officerRankMax} é oficial automaticamente, sem ninguém
            precisar conceder. Não tem o que revogar aqui: quem sai desses ranks no jogo perde o
            status na requisição seguinte.
          </p>
        </div>

        {!rosterOk ? (
          // Lacuna nunca vira zero — Regra 7. Sem isto a tela afirmaria "nenhum
          // oficial automático" quando a verdade é "o roster não respondeu".
          <p className="border-border text-fg-muted rounded-lg border border-dashed p-4 text-sm">
            O roster da Blizzard não respondeu agora, então esta lista está indisponível — não é que
            não haja ninguém. Os ranks dos concedidos à mão também vieram em branco.
          </p>
        ) : byRank.length === 0 ? (
          <p className="border-border text-fg-muted rounded-lg border border-dashed p-4 text-sm">
            Nenhum personagem do roster está nos ranks 0 a {officerRankMax}.
          </p>
        ) : (
          <div className="border-border overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="border-border text-fg-subtle border-b">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Personagem
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Rank
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Conta
                  </th>
                </tr>
              </thead>
              <tbody>
                {byRank.map((o) => (
                  <tr
                    key={`${o.realmSlug}/${o.nameKey}`}
                    className="border-border/60 border-b last:border-0"
                  >
                    <td className="text-fg px-4 py-2 font-mono">
                      {o.name}
                      <span className="text-fg-subtle">-{o.realm}</span>
                    </td>
                    <td className="text-fg-muted px-4 py-2 font-mono tabular-nums">{o.rank}</td>
                    <td className="px-4 py-2 text-xs">
                      {o.linked ? (
                        <span className="text-accent">vinculada</span>
                      ) : (
                        <span className="text-fg-subtle">nunca logou</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-fg text-lg font-semibold tracking-tight">Concedidos à mão</h2>
          <p className="text-fg-muted mt-1 text-sm">
            Para quem precisa ser oficial sem estar nos ranks do topo — raid leader, recrutador. É
            também o que continua valendo se a liderança reorganizar os ranks no jogo.
          </p>
        </div>

        <form
          onSubmit={conceder}
          className="border-border bg-surface flex flex-wrap items-end gap-3 rounded-lg border p-4"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="oficial-nome" className="text-fg-subtle text-xs">
              Personagem
            </label>
            <input
              id="oficial-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              minLength={2}
              maxLength={12}
              placeholder="Zenithus"
              disabled={pendente}
              className="border-border bg-bg text-fg placeholder:text-fg-subtle w-40 rounded-md border px-2 py-1.5 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="oficial-realm" className="text-fg-subtle text-xs">
              Realm
            </label>
            <input
              id="oficial-realm"
              value={realm}
              onChange={(e) => setRealm(e.target.value)}
              required
              minLength={2}
              maxLength={64}
              placeholder="Azralon"
              disabled={pendente}
              className="border-border bg-bg text-fg placeholder:text-fg-subtle w-40 rounded-md border px-2 py-1.5 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={pendente}
            className="border-border text-fg-muted hover:text-fg rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
          >
            {pendente ? '…' : 'Conceder'}
          </button>

          {erro && <p className="text-danger w-full text-xs">{erro}</p>}
        </form>

        {grants.length === 0 ? (
          <p className="border-border text-fg-muted rounded-lg border border-dashed p-4 text-sm">
            Nenhuma concessão à mão. Quem é oficial hoje é oficial pelo rank.
          </p>
        ) : (
          <div className="border-border overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[38rem] text-sm">
              <thead className="border-border text-fg-subtle border-b">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Personagem
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Rank
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Conta
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Concedido por
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.id} className="border-border/60 border-b last:border-0">
                    <td className="text-fg px-4 py-2 font-mono">
                      {g.name}
                      <span className="text-fg-subtle">-{g.realm}</span>
                    </td>

                    <td className="text-fg-muted px-4 py-2 font-mono tabular-nums">
                      {/* Exibição pura: quem decide o acesso desta linha é a
                          concessão, não o rank. Serve para ver que um grant
                          ficou apontando para quem saiu da guilda — e que um
                          grant virou redundante porque o rank já promove. */}
                      {g.rank === null ? (
                        <span className="text-danger font-sans text-xs">
                          {rosterOk ? 'fora do roster' : 'sem roster'}
                        </span>
                      ) : (
                        <>
                          {g.rank}
                          {g.rank <= officerRankMax && (
                            <span className="text-fg-subtle ml-2 font-sans text-xs">
                              já é oficial pelo rank
                            </span>
                          )}
                        </>
                      )}
                    </td>

                    <td className="px-4 py-2 text-xs">
                      {g.linked ? (
                        <span className="text-accent">vinculada</span>
                      ) : (
                        // Diferença que só aparece aqui: um grant certo e um
                        // grant com nome errado são visualmente idênticos sem
                        // isto.
                        <span className="text-fg-subtle">nunca logou</span>
                      )}
                    </td>

                    <td className="text-fg-subtle px-4 py-2 text-xs">{g.grantedBy}</td>

                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => revogar(g)}
                        disabled={pendente}
                        className="border-border text-fg-muted hover:text-danger rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50"
                      >
                        Revogar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
