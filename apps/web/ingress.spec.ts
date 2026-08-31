import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const caddyfile = readFileSync(fileURLToPath(new URL('../../Caddyfile', import.meta.url)), 'utf8');

describe('roteamento do ingress', () => {
  it('/api/sessao chega ao Next antes do catch-all da API', () => {
    const sessao = `handle /api/sessao {\n\t\treverse_proxy web:3000\n\t}`;
    const api = `handle_path /api/* {\n\t\treverse_proxy api:3001\n\t}`;

    expect(caddyfile).toContain(sessao);
    expect(caddyfile).toContain(api);
    expect(caddyfile.indexOf(sessao)).toBeLessThan(caddyfile.indexOf(api));
  });
});
