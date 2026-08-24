export interface Args {
  /** `12.1.0.69299` — obrigatório. Sem build, divergência futura é indistinguível
   * entre bug nosso e mudança de patch (mesma razão da fixture carregar o build). */
  build: string;
  pastaWowExport: string;
  arquivoSaida: string;
  apiBaseUrl: string;
  /** Só usado se vier por `--ops-token`; senão cai no `.env` via `ambiente.ts`. */
  opsToken?: string;
}

const PADRAO = {
  pasta: 'localdocs/wow.export',
  api: 'http://localhost:3001',
};

export function lerArgs(argv: string[]): Args {
  const valores = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const chave = argv[i];
    if (chave?.startsWith('--')) {
      valores.set(chave.slice(2), argv[i + 1] ?? '');
      i++;
    }
  }

  const build = valores.get('build');
  if (!build) {
    throw new Error(
      'Faltou --build (ex.: --build 12.1.0.69299). Ver /run print(GetBuildInfo()) no jogo.',
    );
  }

  const pastaWowExport = valores.get('pasta') ?? PADRAO.pasta;

  return {
    build,
    pastaWowExport,
    arquivoSaida: valores.get('saida') ?? `localdocs/wow-data-${build}.json`,
    apiBaseUrl: valores.get('api') ?? PADRAO.api,
    opsToken: valores.get('ops-token'),
  };
}
