import { raidProgressReportSchema, type RaidProgressReport } from '@titan/shared';
import { API_URL } from '../config';

export interface FonteProgressao {
  relatorio: RaidProgressReport | null;
  desenvolvimento: boolean;
}

/** A leitura do Nest já é cacheada lá; isto evita um salto de rede por visita. */
const REVALIDA_SEGUNDOS = 300;

/**
 * Fonte única da progressão pública da landing.
 *
 * Busca `public/raid-progress` no Nest, que devolve o tier corrente a partir do
 * Warcraft Logs. Pela Regra 6 a chamada à API externa é sempre do Nest — o
 * browser nunca fala com o Warcraft Logs, e o cache vive num lugar só.
 *
 * **Falha de API não derruba página.** Qualquer erro — API fora, timeout,
 * resposta fora do schema — vira `null`, e a landing diz "fonte pendente" em
 * vez de inventar número ou quebrar. É a Regra 6 outra vez: degradar para o
 * último dado bom ou esconder a seção.
 *
 * Em desenvolvimento, se a API não responder, cai no mock para a página
 * continuar montável sem subir o backend inteiro. O mock **nunca** entra em
 * produção: lá a ausência de dado é informação, e fingir progressão é o oposto
 * do que a landing promete.
 */
export async function carregarProgressao(): Promise<FonteProgressao> {
  try {
    const res = await fetch(`${API_URL}/public/raid-progress`, {
      next: { revalidate: REVALIDA_SEGUNDOS },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Nest serializa `null` como corpo **vazio**, não como a string "null".
    // Ler o texto antes de desserializar torna isso explícito: sem isso o
    // `res.json()` estouraria e "não há season gravada" viraria "a API falhou",
    // que são coisas diferentes e pedem tratamento diferente.
    const texto = (await res.text()).trim();
    if (!texto) return { relatorio: null, desenvolvimento: false };

    const corpo: unknown = JSON.parse(texto);
    if (corpo === null) return { relatorio: null, desenvolvimento: false };

    const lido = raidProgressReportSchema.safeParse(corpo);
    if (!lido.success) throw new Error('resposta fora do schema');

    return { relatorio: lido.data, desenvolvimento: false };
  } catch {
    return mockDeDesenvolvimento();
  }
}

async function mockDeDesenvolvimento(): Promise<FonteProgressao> {
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
