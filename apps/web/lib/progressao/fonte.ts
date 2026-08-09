import type { RaidProgressReport } from '@titan/shared';

export interface FonteProgressao {
  relatorio: RaidProgressReport | null;
  desenvolvimento: boolean;
}

/**
 * Fonte única da progressão pública da landing.
 *
 * **Hoje só existe mock de desenvolvimento.** A API expõe raid progress apenas
 * em `internal/raid-progress`, atrás do `MemberGuard` — não há endpoint público.
 * Enquanto não houver, produção fica sem leitura, e a landing diz isso em vez de
 * inventar número (ver §15 do doc 05: não fingir que dado pendente existe).
 *
 * Quando o endpoint público chegar, é **este** arquivo que muda; nem o layout
 * nem a hero precisam saber de onde o dado vem.
 */
export async function carregarProgressao(): Promise<FonteProgressao> {
  if (process.env.NODE_ENV === 'production') return { relatorio: null, desenvolvimento: false };
  const { PROGRESSAO_MOCK_PARCIAL } = await import('../mock/progressao.mock');
  return { relatorio: PROGRESSAO_MOCK_PARCIAL, desenvolvimento: true };
}

/**
 * Crédito da aferição, exibido no rodapé da hero.
 *
 * Com dado: nomeia a fonte e a hora da última leitura — é o que dá crédito à
 * aferição e o que o visitante precisa para confiar no número.
 * Sem dado: assume que a fonte está pendente, sem prometer nada.
 */
export function creditoAfericao(fonte: FonteProgressao): string {
  const { relatorio, desenvolvimento } = fonte;
  if (!relatorio?.fetchedAt)
    return 'Aferição pública preparada para Warcraft Logs · fonte pendente';

  const quando = new Date(relatorio.fetchedAt).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return [
    'Progressão aferida no Warcraft Logs',
    relatorio.stale ? `última leitura boa: ${quando}` : `atualizado em ${quando}`,
    desenvolvimento ? 'dados de desenvolvimento' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
