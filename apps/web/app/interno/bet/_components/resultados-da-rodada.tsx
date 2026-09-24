import type { ClosingPublicado } from '@titan/shared';
import { useId } from 'react';
import { Quando } from '../../mplus/_components/quando';
import { gold, motivo, personagem, tituloDoMercado } from './rotulos';

type MercadoPublicado = ClosingPublicado['conteudo']['mercados'][number];

/**
 * O Round Closing Report publicado (T-UI10; D-21, D-48). Só o documento como
 * foi validado e gravado — nenhuma consulta sobre apostas montada na hora. O
 * membro aparece pelo personagem de elegibilidade, nunca pelo BattleTag, e só
 * quem ganhou; aposta perdedora, stake e escolha não existem no contrato.
 */
export function ResultadosDaRodada({ closing }: { closing: ClosingPublicado }) {
  const { conteudo } = closing;
  // Só houve redistribuição se algum mercado teve vencedor para receber (D-61).
  const algumVencedor = conteudo.mercados.some((m) => m.desfecho === 'vencedores');

  return (
    <div className="flex flex-col gap-6">
      <p className="text-fg-subtle text-xs">
        Versão {closing.version}, publicada em <Quando iso={closing.publishedAt} />.
      </p>

      {!algumVencedor && (
        <p className="text-fg-muted text-sm">Nenhum mercado teve vencedor nesta rodada.</p>
      )}

      {conteudo.mercados.map((m) => (
        <Mercado key={m.marketId} mercado={m} algumVencedor={algumVencedor} />
      ))}

      <section className="border-border flex flex-col gap-2 rounded-lg border p-4">
        <h3 className="text-fg text-sm font-semibold">Total devido por membro</h3>
        {conteudo.totais.length === 0 && (
          <p className="text-fg-muted text-sm">Ninguém tem valor a receber nesta rodada.</p>
        )}
        <ul className="flex flex-col gap-1">
          {conteudo.totais.map((t) => (
            <li key={personagem(t.membro)} className="text-fg text-sm">
              {personagem(t.membro)}: {gold(t.devido)}
            </li>
          ))}
        </ul>
        <p className="text-fg-muted text-xs">
          Guild Bank — receita: {gold(conteudo.guildBank.receita)} · resíduo do arredondamento:{' '}
          {gold(conteudo.guildBank.residuo)}
        </p>
      </section>
    </div>
  );
}

function Mercado({
  mercado: m,
  algumVencedor,
}: {
  mercado: MercadoPublicado;
  algumVencedor: boolean;
}) {
  const id = useId();

  return (
    <section
      aria-labelledby={id}
      className="border-border flex flex-col gap-2 rounded-lg border p-4"
    >
      <h3 id={id} className="text-fg text-sm font-semibold">
        {tituloDoMercado(m.kind, m.encounterName)}
      </h3>

      {m.desfecho === 'sem_vencedor' && (
        <p className="text-fg-muted text-sm">
          Sem vencedor: {motivo(m.motivo)}.
          {algumVencedor &&
            ' O prize pool deste mercado foi redistribuído entre os mercados com vencedor.'}
        </p>
      )}
      {m.desfecho === 'anulado' && (
        <p className="text-fg-muted text-sm">
          Anulado: {motivo(m.motivo)}. As apostas válidas foram restituídas.
        </p>
      )}

      {m.desfecho === 'vencedores' && (
        <ul className="flex flex-wrap gap-2">
          {m.kind === 'weekly_progression'
            ? m.bossesVencedores.map((b) => (
                <li key={b} className="text-fg text-sm">
                  {b}
                </li>
              ))
            : m.vencedores.map((v) => (
                <li key={personagem(v)} className="text-fg text-sm">
                  {personagem(v)}
                </li>
              ))}
        </ul>
      )}

      {m.ganhos.length > 0 && (
        <ul className="flex flex-col gap-1">
          {m.ganhos.map((g) => (
            <li key={personagem(g.membro)} className="text-fg-muted text-sm">
              {personagem(g.membro)} ganhou {gold(g.valor)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
