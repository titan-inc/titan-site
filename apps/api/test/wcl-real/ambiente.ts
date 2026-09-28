import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { prepararAmbienteDeTeste } from '../db/ambiente';

/**
 * Ambiente do harness de validação com o WCL real (titan-bet-test-design.md
 * §40). Fora do `pnpm test` e do `pnpm test:db`: só roda com a config própria,
 * à mão.
 *
 * O banco é **só** o `titan_test`, pela mesma guarda do `test:db`. Do `.env` da
 * raiz entram apenas as credenciais de leitura das fontes externas — nunca o
 * `DATABASE_URL` de dev.
 */
const CREDENCIAIS = [
  'WARCRAFTLOGS_CLIENT_ID',
  'WARCRAFTLOGS_CLIENT_SECRET',
  'BLIZZARD_CLIENT_ID',
  'BLIZZARD_CLIENT_SECRET',
  'BLIZZARD_REGION',
  'WOW_AUDIT_KEY',
  'GUILD_NAME',
  'GUILD_REALM',
  'GUILD_TIMEZONE',
];

prepararAmbienteDeTeste();

let doArquivo: Record<string, string> = {};
try {
  doArquivo = parse(readFileSync(path.resolve(__dirname, '../../../../.env')));
} catch {
  // Sem .env não há credencial: o harness falha na primeira chamada, que é o certo.
}
for (const chave of CREDENCIAIS) {
  if (process.env[chave] === undefined && doArquivo[chave] !== undefined) {
    process.env[chave] = doArquivo[chave];
  }
}
