import type { LootHistoryEntry } from '@titan/shared';

const DIFICULDADE_CURTA: Record<string, string> = {
  normal: 'N',
  heroic: 'H',
  mythic: 'M',
};

/**
 * Data no fuso da guilda.
 *
 * Não em UTC: a raid começa 21:00 BRT, que já é o dia seguinte em UTC, então a
 * entrega da noite de sexta apareceria como sábado. É o mesmo cuidado que o
 * filtro de data tem do lado da API.
 */
function dataDaEntrega(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(new Date(iso));
}

/** URL do ícone a partir do slug. O slug é estável; a URL se compõe na hora. */
function urlDoIcone(icon: string): string {
  return `https://render.worldofwarcraft.com/us/icons/56/${icon}.jpg`;
}

/**
 * As entregas, uma por linha.
 *
 * Nome e ícone saem do **catálogo**, nunca do que a fonte gravou: o `itemName`
 * do RCLootCouncil vem no idioma do cliente de quem era loot master, e o mesmo
 * item apareceria em dois idiomas na mesma lista (TIT-49).
 *
 * Voto e nota ficam de fora de propósito. Voto fora de contexto vira placar
 * entre pessoas, que é o que a Regra 7 manda evitar — a régua dela é "isto vira
 * comparação entre membros?".
 */
export function TabelaHistorico({
  entries,
  total,
}: {
  entries: LootHistoryEntry[];
  total: number;
}) {
  if (entries.length === 0) {
    return (
      <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
        Nenhuma entrega com esses filtros.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-fg-subtle text-xs">
        {total} {total === 1 ? 'entrega' : 'entregas'}
      </p>

      {/* A tabela é larga e o container rola sozinho, para a página não ganhar
          rolagem horizontal inteira no celular. */}
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-border text-fg-subtle border-b text-left font-mono text-xs tracking-widest uppercase">
              <th scope="col" className="px-3 py-2 font-medium">
                Data
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Personagem
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Item
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Boss
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Resposta
              </th>
            </tr>
          </thead>

          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-border/60 border-b last:border-0">
                <td className="text-fg-muted px-3 py-2 font-mono whitespace-nowrap tabular-nums">
                  {dataDaEntrega(e.awardedAt)}
                </td>

                <td className="text-fg px-3 py-2 whitespace-nowrap">
                  {e.winner.name}
                  <span className="text-fg-subtle">-{e.winner.realm}</span>
                </td>

                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    {e.item.icon && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={urlDoIcone(e.item.icon)}
                        alt=""
                        width={20}
                        height={20}
                        className="rounded"
                      />
                    )}
                    {/* Item que o catálogo ainda não tem fica sem nome. Mostrar
                        o id é melhor que mostrar o nome localizado da fonte. */}
                    <span className={e.item.name ? 'text-fg' : 'text-fg-subtle'}>
                      {e.item.name ?? `Item ${e.item.itemId}`}
                    </span>
                  </span>
                </td>

                <td className="px-3 py-2">
                  {/* 26% do histórico não casou com o catálogo, por nome
                      traduzido ou boss `Unknown`. A grafia da fonte fica, em
                      tom apagado — esconder um quarto das linhas seria pior. */}
                  <span className={e.boss.encounterId ? 'text-fg-muted' : 'text-fg-subtle italic'}>
                    {e.boss.name}
                  </span>
                  {e.difficulty && (
                    <span className="text-fg-subtle ml-2 font-mono text-xs">
                      {DIFICULDADE_CURTA[e.difficulty] ?? e.difficulty}
                    </span>
                  )}
                </td>

                <td className="text-fg-muted px-3 py-2 whitespace-nowrap">{e.response.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
