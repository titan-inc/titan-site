import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const caddyfile = readFileSync(fileURLToPath(new URL('../../Caddyfile', import.meta.url)), 'utf8');

/**
 * O Caddyfile é código de roteamento sem typecheck e sem CI que o exercite, e
 * ele já quebrou o login uma vez: `/api/sessao` caía no `handle_path /api/*`
 * genérico e ia parar no Nest, que respondia 404 (PR #112).
 *
 * Aquele caso morreu com o popup na TIT-148 — não existe mais `/api/sessao`.
 * O arquivo fica porque a **classe** do erro não morreu: `handle_path /api/*`
 * é um catch-all, e toda regra mais específica que precise vir antes dele
 * depende de ordem no arquivo, que nada mais verifica.
 */
describe('roteamento do ingress', () => {
  const ops = `handle /api/internal/ops/* {\n\t\trespond 404\n\t}`;
  const api = `handle_path /api/* {\n\t\treverse_proxy api:3001\n\t}`;

  // Esta é defesa em profundidade da TIT-109, não conveniência: se a ordem
  // inverter, as rotas de ops passam a ser alcançáveis pelo domínio público e
  // só o OpsTokenGuard segura. A inversão não gera erro nenhum — só abre a
  // porta, em silêncio.
  it('/api/internal/ops/* é bloqueado antes do catch-all da API', () => {
    expect(caddyfile).toContain(ops);
    expect(caddyfile).toContain(api);
    expect(caddyfile.indexOf(ops)).toBeLessThan(caddyfile.indexOf(api));
  });

  it('não sobrou rota de confirmação de sessão apontando para o Next', () => {
    expect(caddyfile).not.toContain('/api/sessao');
  });
});
