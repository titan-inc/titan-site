import fs from 'node:fs';
import path from 'node:path';

/**
 * Lê `OPS_TRIGGER_TOKEN` do `.env` da raiz quando ele não veio por variável
 * de ambiente nem por `--ops-token`. O script roda fora do processo do Nest
 * (Regra 8), então não herda o `dotenvx` que a API injeta sozinha — sem
 * isso, cada execução exigiria exportar a variável à mão no shell.
 *
 * Parser mínimo de propósito: só o suficiente para `CHAVE="valor"` linha a
 * linha, o formato que `.env` usa aqui. Não é dotenv completo (sem
 * interpolação, sem multilinha) porque o script não precisa do resto.
 */
export function carregarOpsTokenDoEnv(): string {
  if (process.env.OPS_TRIGGER_TOKEN) {
    return process.env.OPS_TRIGGER_TOKEN;
  }

  const caminhoEnv = path.resolve(import.meta.dirname, '..', '..', '.env');
  if (!fs.existsSync(caminhoEnv)) {
    throw new Error(`OPS_TRIGGER_TOKEN não está definido e ${caminhoEnv} não existe.`);
  }

  const linhas = fs.readFileSync(caminhoEnv, 'utf8').split(/\r?\n/);
  for (const linha of linhas) {
    const match = /^OPS_TRIGGER_TOKEN\s*=\s*"?([^"]*)"?\s*$/.exec(linha);
    if (match) {
      return match[1] ?? '';
    }
  }

  throw new Error(`OPS_TRIGGER_TOKEN não está definido em ${caminhoEnv}.`);
}
