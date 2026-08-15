'use client';

import { respostasVisiveis, type LootSessionDetail, type LootSessionItemView } from '@titan/shared';
import { useState } from 'react';

/** Uma linha da tabela: uma pessoa naquela peça. */
interface LinhaDoQuadro {
  chave: string;
  nome: string;
  souEu: boolean;
  resposta: string | null;
  roll: number | null;
  nota: string | null;
}

/**
 * Quem entra na tabela de uma peça.
 *
 * A base são os **participantes** — todos, tenham respondido ou não: sumir com
 * quem ficou calado faria a lista parecer menor que a raid.
 *
 * Mais quem tem resposta e não está entre eles. Isso não acontece em sessão
 * nova, onde só participante responde, mas acontece nas que vieram de antes da
 * TIT-126 — e uma resposta que existe e não aparece é pior que uma linha a mais.
 */
function montarLinhas(
  sessao: LootSessionDetail,
  item: LootSessionItemView,
  aberto: boolean,
): LinhaDoQuadro[] {
  const eu = sessao.minhaParticipacao;
  const respostas = aberto ? item.respostas : [];

  const linhas = sessao.participantes.map((p) => {
    const dele = respostas.find((r) => r.name === p.name && r.realm === p.realm) ?? null;
    const souEu = eu !== null && eu.nameKey === p.nameKey && eu.realmKey === p.realmKey;

    return {
      chave: `${p.nameKey}|${p.realmKey}`,
      nome: p.name,
      souEu,
      // Fora da fase aberta, a própria resposta ainda vem por `minhaResposta`.
      resposta:
        dele?.responseOptionSlug ??
        (souEu ? (item.minhaResposta?.responseOptionSlug ?? null) : null),
      roll: dele?.roll ?? (souEu ? (item.minhaResposta?.roll ?? null) : null),
      nota: dele?.note ?? (souEu ? (item.minhaResposta?.note ?? null) : null),
    };
  });

  const jaListados = new Set(linhas.map((l) => l.nome));
  const avulsas = respostas
    .filter((r) => !jaListados.has(r.name))
    .map((r) => ({
      chave: `avulsa|${r.name}|${r.realm}`,
      nome: r.name,
      souEu: false,
      resposta: r.responseOptionSlug,
      roll: r.roll,
      nota: r.note,
    }));

  return [...linhas, ...avulsas];
}

/**
 * "12 de 25 responderam", ou só a contagem quando o total não faz sentido.
 *
 * O numerador conta respostas e o denominador conta participantes, e nas
 * sessões anteriores à TIT-126 o primeiro pode passar o segundo. "3 de 1
 * responderam" é uma fração impossível na tela de quem está raidando.
 */
function contagem(responderam: number, pessoas: number): string {
  return responderam <= pessoas
    ? `${responderam} de ${pessoas} responderam`
    : `${responderam} responderam`;
}

/**
 * O quadro por abas: uma aba por peça, com todo mundo que está na sessão.
 *
 * **Versão de membro.** A do conselho tem votos, histórico e os botões de
 * entrega, e é componente separado (TIT-129) — não este com flags por dentro.
 * Flag de acesso espalhada é a tela prometendo uma organização que o backend
 * não entrega.
 *
 * O que aparece em cada célula vem pronto da API: na fase de roll ela manda só
 * a própria resposta, e `respostas` chega vazio. A tela não filtra nada.
 */
export function QuadroDeRespostas({
  sessao,
  aoAbrirCard,
}: {
  sessao: LootSessionDetail;
  aoAbrirCard: ((itemId: string) => void) | null;
}) {
  const [abaId, setAbaId] = useState(sessao.items[0]?.id ?? '');
  const aba = sessao.items.find((i) => i.id === abaId) ?? sessao.items[0] ?? null;

  if (aba === null) {
    return (
      <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
        Esta sessão não tem peça nenhuma.
      </p>
    );
  }

  const aberto = respostasVisiveis(sessao.status);
  const linhas = montarLinhas(sessao, aba, aberto);

  return (
    <section className="border-border overflow-hidden rounded-lg border">
      <div className="border-border flex gap-1 overflow-x-auto border-b p-2">
        {sessao.items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setAbaId(item.id)}
            className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${
              item.id === aba.id ? 'bg-fg text-bg font-medium' : 'text-fg-muted hover:text-fg'
            }`}
          >
            {item.name ?? `Peça ${i + 1}`}
            {item.minhaResposta === null && aoAbrirCard !== null && (
              <span className="ml-1.5 text-amber-400" aria-label="sem resposta">
                •
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <p className="text-fg-muted text-xs">{contagem(aba.totalDeRespostas, linhas.length)}</p>

        {aoAbrirCard !== null && (
          <button
            type="button"
            onClick={() => aoAbrirCard(aba.id)}
            className="text-fg text-xs underline"
          >
            {aba.minhaResposta === null ? 'responder' : 'trocar minha resposta'}
          </button>
        )}
      </div>

      <table className="w-full text-sm">
        <thead className="text-fg-subtle border-border border-y text-left text-xs">
          <tr>
            <th className="px-4 py-2 font-medium">Personagem</th>
            <th className="px-4 py-2 font-medium">Resposta</th>
            <th className="px-4 py-2 font-medium">Roll</th>
          </tr>
        </thead>

        <tbody>
          {linhas.map((linha) => (
            <tr key={linha.chave} className="border-border border-b last:border-0">
              <td className="text-fg px-4 py-2">
                {linha.nome}
                {linha.souEu && <span className="text-fg-subtle text-xs"> (você)</span>}
              </td>

              <td className="px-4 py-2">
                {linha.resposta === undefined || linha.resposta === null ? (
                  <span className="text-fg-subtle">—</span>
                ) : (
                  <span className="text-fg">{linha.resposta}</span>
                )}
                {linha.nota !== null && linha.nota !== undefined && (
                  <span className="text-fg-muted block text-xs">{linha.nota}</span>
                )}
              </td>

              <td className="text-fg-muted px-4 py-2">{linha.roll ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {!aberto && (
        <p className="text-fg-subtle border-border border-t px-4 py-2.5 text-xs">
          As respostas aparecem para todo mundo quando o conselho fechar a fase de roll.
        </p>
      )}
    </section>
  );
}
