import { redirect } from 'next/navigation';
import { getLootHistory, getLootHistoryFacets } from '../../../../lib/api';
import { FiltrosHistorico } from '../_components/filtros-historico';
import { filtrosDaApi, seasonParaApi, type BuscaHistorico } from '../_components/historico-url';
import { Paginacao } from '../_components/paginacao';
import { TabelaHistorico } from '../_components/tabela-historico';

export const metadata = { title: 'Histórico de loot — Titan Inc' };

/**
 * Tudo que o conselho já distribuiu. Fecha TIT-59.
 *
 * O estado da tela mora na URL, e não em `useState`: assim um filtro montado dá
 * link para mandar no Discord, que é como a Regra 7 diz que as coisas circulam
 * aqui — "todo post no Discord linka fundo, na página exata".
 *
 * Visível para todo mundo da área interna. Loot é decisão que o conselho tomou
 * na frente da raid, não comportamento de uma pessoa — ver a Regra 7. O guard
 * de verdade é o `MemberGuard` no Nest; esta página só evita tela quebrada.
 */
export default async function LootHistoricoPage({
  searchParams,
}: {
  searchParams: Promise<BuscaHistorico>;
}) {
  const busca = await searchParams;
  const season = seasonParaApi(busca.season);

  const facets = await getLootHistoryFacets(season);

  // Primeira visita sem season na URL: manda para a mais recente, em vez de
  // aplicar o padrão em silêncio. O estado passa a estar todo na URL, e o link
  // que a pessoa copiar mostra a mesma tela para quem abrir.
  const maisRecente = facets?.seasons.find((s) => s.id !== null)?.id;
  if (busca.season === undefined && maisRecente !== undefined) {
    redirect(`/interno/loot/historico?season=${maisRecente}`);
  }

  const pagina = await getLootHistory(filtrosDaApi(busca, season));

  return (
    <div className="flex flex-col gap-5">
      {facets === null ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Não foi possível carregar o histórico agora.
        </p>
      ) : (
        <>
          <FiltrosHistorico facets={facets} selecionado={busca} />

          {pagina === null ? (
            <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
              Não foi possível carregar as entregas agora.
            </p>
          ) : (
            <>
              <TabelaHistorico entries={pagina.entries} total={pagina.total} />
              <Paginacao pagina={pagina} busca={busca} />
            </>
          )}
        </>
      )}
    </div>
  );
}
