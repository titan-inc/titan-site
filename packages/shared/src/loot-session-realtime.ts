import { z } from 'zod';

/**
 * O aviso de mudança da sessão de loot ao vivo — TIT-68.
 *
 * O stream (SSE) carrega só "a sessão X mudou", nunca dado. O throttle
 * consolida a tempestade de eventos no servidor, POR SESSÃO; o jitter espalha
 * o `router.refresh()` dos clientes que chegam juntos.
 *
 * Um schema de OBJETO, com os dois campos juntos, porque `jitterMs <=
 * throttleMs` é regra que CRUZA os dois — jitter maior que o throttle
 * atropelaria o refetch de um aviso no do aviso seguinte. Não faz sentido
 * validar cada campo isolado.
 *
 * Três consumidores ao longo do tempo, todos contra o MESMO schema: o boot lê
 * do env hoje; um futuro `PATCH` de configuração e o resolver do futuro form
 * usam o mesmo clamp amanhã. Clamp escrito duas vezes diverge em silêncio —
 * Regra 2.
 *
 * Os pisos e tetos não são estética: abaixo de 250ms o throttle para de
 * consolidar de verdade numa tempestade (três itens cobiçados caem e a raid
 * inteira responde em segundos); acima de 10s a ferramenta parece quebrada ao
 * vivo. Jitter zero é legítimo — desliga o espalhamento —, e o teto de 2000ms
 * existe porque ele SOMA à latência percebida em cima do throttle.
 */
export const lootSessionRealtimeConfigSchema = z
  .object({
    /** Consolidação da tempestade, no servidor, por sessão. Padrão 1000ms. */
    throttleMs: z.number().int().min(250).max(10_000).default(1000),

    /** Espalha o refetch dos clientes que recebem o aviso juntos. Padrão 300ms. */
    jitterMs: z.number().int().min(0).max(2000).default(300),
  })
  .refine((v) => v.jitterMs <= v.throttleMs, {
    message: 'jitterMs não pode ser maior que throttleMs',
    path: ['jitterMs'],
  });

export type LootSessionRealtimeConfig = z.infer<typeof lootSessionRealtimeConfigSchema>;
