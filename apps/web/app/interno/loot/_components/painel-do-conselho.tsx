'use client';

import { podeVotar, type LootCouncilPanel, type LootSessionDetail } from '@titan/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ControlesDaSessao } from './controles-da-sessao';
import { QuadroDoConselho } from './quadro-do-conselho';

/**
 * A metade de cima: controles da sessão e o quadro de quem decide.
 *
 * **Colapsável, e é o ponto.** Colapsado, o que sobra na tela é próximo do que
 * a raid inteira vê — o loot master enxerga a sessão como ela é enxergada, sem
 * precisar de outra conta.
 *
 * Para o membro esta metade **não existe**: a página só a renderiza quando o
 * painel veio, e ele só vem para quem passa no `OfficerGuard`. Esconder na tela
 * é UX; quem recusa é o Nest (Regra 5).
 */
export function PainelDoConselho({
  sessao,
  painel,
}: {
  sessao: LootSessionDetail;
  painel: LootCouncilPanel;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(true);

  // O nome e o ícone da peça vivem no detalhe, não no painel: o painel é sobre
  // a decisão, e repetir o catálogo nele criaria duas fontes para o mesmo nome.
  const nomeDosItens = new Map(
    sessao.items.map((i) => [i.id, { nome: i.name ?? `Item ${i.itemId}`, icone: i.icon }]),
  );

  const pendentes = painel.itens.filter((i) => i.award === null).length;

  return (
    <section className="border-border rounded-lg border">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setAberto(!aberto)}
          aria-expanded={aberto}
          className="text-fg flex items-center gap-2 text-sm font-medium"
        >
          <span aria-hidden>{aberto ? '▾' : '▸'}</span>
          Conselho
          <span className="text-fg-subtle font-normal">
            {pendentes === 0
              ? 'tudo entregue'
              : pendentes === 1
                ? '1 peça sem dono'
                : `${pendentes} peças sem dono`}
          </span>
        </button>

        <ControlesDaSessao
          sessionId={sessao.id}
          status={sessao.status}
          aoMudar={() => router.refresh()}
        />
      </header>

      {aberto && (
        <div className="border-border border-t p-4">
          <QuadroDoConselho
            painel={painel}
            nomeDosItens={nomeDosItens}
            podeDecidir={podeVotar(sessao.status)}
            aoAgir={() => router.refresh()}
          />
        </div>
      )}
    </section>
  );
}
