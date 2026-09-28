import { z } from 'zod';
import { computedItemStatsSchema } from './item-computation.js';

/**
 * O item, pronto para a tela — TIT-135. A unificação de propósito das duas
 * formas que eram só o catálogo (`loot-session-dto.ts`, `loot-history.ts`):
 * a mesma peça, com o mesmo shape, nos dois lugares que o consomem hoje
 * (cards da sessão ao vivo, tabela do histórico).
 *
 * ```
 * itemViewSchema  =  campos do catálogo (name, icon, equipLoc, itemSubclass)
 *                  +  itemString
 *                  +  ComputedItemStats
 * ```
 *
 * **Não é 4 → 1.** `recebidoAntes` (`loot-council-dto.ts`) fica de fora —
 * é UMA ENTREGA (tem `awardedAt`/`responseOptionSlug`), não um item, e o
 * recorte mínimo dele já está documentado lá. Forçá-lo aqui arrastaria o
 * payload de tooltip inteiro pra uma lista que só responde "quantas peças
 * ela já levou", ou tornaria estes campos opcionais pra acomodá-lo — e campo
 * opcional é a união que esta issue existe pra evitar.
 *
 * `itemId`/`itemString` continuam FORA de `ComputedItemStats` de propósito
 * (ver o comentário lá): aquele objeto é o cálculo, puro, sem saber em qual
 * item ele está pendurado. Quem junta os dois é este schema.
 */
export const itemViewSchema = z
  .object({
    itemId: z.number().int().positive(),

    /** Nome, ícone e slot do catálogo. Nulos quando o item ainda não foi
     * enriquecido — a linha existe mesmo assim, e a tela mostra o id. */
    name: z.string().nullable(),
    icon: z.string().nullable(),
    equipLoc: z.string().nullable(),
    itemSubclass: z.string().nullable(),

    /**
     * O `itemString` cru, inteiro. Vai para a tela porque duas peças com o
     * mesmo `itemId` podem ser coisas diferentes — observado em raid real,
     * mesmo boss: duas cópias de `202593` com bônus `9415` e `9414`. Sem
     * isso o tooltip não sabe qual das duas está mostrando.
     */
    itemString: z.string(),
  })
  .merge(computedItemStatsSchema);
export type ItemView = z.infer<typeof itemViewSchema>;
