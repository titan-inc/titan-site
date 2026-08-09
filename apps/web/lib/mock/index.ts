if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'lib/mock foi importado em produção. Placeholder não vai para o ar: remover o import ou trocar pela chamada real da API.',
  );
}

export async function carregarMockSeDev<T>(carregar: () => Promise<T>): Promise<T | null> {
  if (process.env.NODE_ENV === 'production') return null;
  return carregar();
}
