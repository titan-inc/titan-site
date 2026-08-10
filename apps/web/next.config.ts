import path from 'node:path';
import type { NextConfig } from 'next';

const raizDoMonorepo = path.join(import.meta.dirname, '../..');

const nextConfig: NextConfig = {
  turbopack: {
    // Sem isso o Next sobe a árvore procurando lockfile e escolhe a home do
    // usuário como raiz (existe um package-lock.json solto lá). Fixa na raiz
    // real do monorepo.
    root: raizDoMonorepo,
  },

  /**
   * Emite `.next/standalone`: um `server.js` mínimo com só os `node_modules`
   * que o trace provou serem necessários.
   *
   * É o que torna a imagem Docker viável. Sem isto, o runtime precisaria do
   * `node_modules` inteiro do monorepo — e a árvore do pnpm é feita de symlinks
   * para uma store, que não sobrevive a um `COPY` entre estágios.
   */
  output: 'standalone',

  /**
   * O trace usa o diretório do projeto por padrão, e aí tudo que vem de
   * `packages/shared` e da store do pnpm na raiz ficaria de fora — o container
   * subiria e só quebraria no primeiro import, em runtime.
   */
  outputFileTracingRoot: raizDoMonorepo,
};

export default nextConfig;
