import { lootSessionRealtimeConfigSchema, type LootSessionRealtimeConfig } from '@titan/shared';

/**
 * Lê e valida o throttle/jitter do aviso de mudança da sessão — TIT-68.
 *
 * Nesta versão os dois valores vêm de env; a validação é o mesmo schema de
 * objeto do shared que um futuro `PATCH` de configuração vai usar (Regra 2).
 *
 * Valor fora da faixa faz a API NÃO SUBIR — mesmo precedente do
 * `GUILD_OFFICER_RANK_MAX` em `guild.config.ts`: melhor falhar no deploy do
 * que rodar a raid com um throttle de 10ms.
 *
 * Ausente cai no default do schema (throttle 1000ms, jitter 300ms): um `.env`
 * de antes desta issue não pode derrubar a API no boot.
 */
export function loadLootSessionRealtimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): LootSessionRealtimeConfig {
  const bruto = {
    throttleMs: paraNumeroOuIndefinido(env.LOOT_SESSION_REALTIME_THROTTLE_MS),
    jitterMs: paraNumeroOuIndefinido(env.LOOT_SESSION_REALTIME_JITTER_MS),
  };

  const validado = lootSessionRealtimeConfigSchema.safeParse(bruto);
  if (!validado.success) {
    throw new Error(
      'Config de realtime da sessão de loot inválida ' +
        '(LOOT_SESSION_REALTIME_THROTTLE_MS/LOOT_SESSION_REALTIME_JITTER_MS): ' +
        validado.error.issues.map((i) => i.message).join('; '),
    );
  }

  return validado.data;
}

/**
 * `undefined` quando a variável não está definida — é o que deixa o
 * `.default()` do schema entrar. Presente e não-numérico vira `NaN`, que o
 * schema recusa (nunca cai em default silencioso).
 */
function paraNumeroOuIndefinido(raw: string | undefined): number | undefined {
  const valor = raw?.trim();
  return valor ? Number(valor) : undefined;
}
