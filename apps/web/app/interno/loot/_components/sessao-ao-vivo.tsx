'use client';

import { respostaLivre, type CharacterRef, type LootSessionDetail } from '@titan/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CardDeResposta } from './card-de-resposta';
import { EntrarNaSessao } from './entrar-na-sessao';
import { QuadroDeRespostas } from './quadro-de-respostas';

/**
 * A metade de baixo da janela: a sessão como todo mundo a vê.
 *
 * Conselheiro e loot master **também** são candidatos, porque raidam — esta é a
 * tela deles também, e o painel de conselho se soma por cima (TIT-129), não
 * substitui.
 *
 * Orquestra e mais nada: decide quem entra, qual card está aberto e quando
 * recarregar. O que cada pedaço mostra é problema do pedaço.
 */
export function SessaoAoVivo({
  sessao,
  personagens,
}: {
  sessao: LootSessionDetail;
  personagens: CharacterRef[];
}) {
  const router = useRouter();
  const [abertoId, setAbertoId] = useState<string | null>(null);

  const participando = sessao.minhaParticipacao !== null;
  const podeResponder = participando && respostaLivre(sessao.status);

  const semResposta = sessao.items.filter((i) => i.minhaResposta === null);
  const aberto = sessao.items.find((i) => i.id === abertoId) ?? null;

  /**
   * Depois de qualquer escrita, recarrega os Server Components.
   *
   * `refresh()` mantém o estado local — o card aberto continua aberto — e
   * traz o payload novo, que é o que decide o que aparece. Sem realtime ainda:
   * é a TIT-68 que resolve.
   */
  const recarregar = () => router.refresh();

  return (
    <div className="flex flex-col gap-5">
      <EntrarNaSessao
        sessionId={sessao.id}
        personagens={personagens}
        participacao={sessao.minhaParticipacao}
        encerrada={sessao.status === 'encerrada'}
        aoEntrar={recarregar}
      />

      {participando && (
        <>
          <QuadroDeRespostas sessao={sessao} aoAbrirCard={podeResponder ? setAbertoId : null} />

          {podeResponder && semResposta.length > 0 && aberto === null && (
            <button
              type="button"
              onClick={() => setAbertoId(semResposta[0]?.id ?? null)}
              className="bg-fg text-bg fixed right-6 bottom-6 z-40 rounded-full px-5 py-3 text-sm font-medium shadow-lg"
            >
              {semResposta.length === 1
                ? '1 peça sem resposta'
                : `${semResposta.length} peças sem resposta`}
            </button>
          )}

          {aberto !== null && (
            <CardDeResposta
              sessionId={sessao.id}
              item={aberto}
              opcoes={sessao.opcoesDeResposta}
              aoFechar={() => setAbertoId(null)}
              aoResponder={recarregar}
            />
          )}
        </>
      )}
    </div>
  );
}
