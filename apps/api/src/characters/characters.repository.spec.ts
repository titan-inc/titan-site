import type { PrismaService } from '../prisma/prisma.service';
import { characterSelect, CharactersRepository } from './characters.repository';

function montar() {
  const findUnique = jest.fn(() => Promise.resolve(null));
  const prisma = { character: { findUnique } } as unknown as PrismaService;
  const repo = new CharactersRepository(prisma);
  return { repo, findUnique };
}

describe('CharactersRepository.buscarPorChave', () => {
  it('manda só nameKey/realmKey pro Prisma, mesmo se o chamador passar um objeto mais rico', async () => {
    const { repo, findUnique } = montar();

    // Reproduz o bug real (visto ao entrar numa sessão de loot):
    // `LootSessionsRepository` repassa o "personagem" inteiro, que também
    // carrega `name`/`realm` — TS deixa passar porque não há
    // excess-property-check em variável repassada, só em objeto literal. O
    // Prisma, em runtime, rejeitava a chave extra no `where` composto com
    // "Unknown argument `name`".
    const chaveRica = {
      nameKey: 'shrewd',
      realmKey: 'azralon',
      name: 'Shrëwd',
      realm: 'Azralon',
    };

    await repo.buscarPorChave(chaveRica);

    expect(findUnique).toHaveBeenCalledWith({
      where: { nameKey_realmKey: { nameKey: 'shrewd', realmKey: 'azralon' } },
      select: characterSelect,
    });
  });

  it('devolve null quando não existe — nunca cria', async () => {
    const { repo } = montar();

    expect(await repo.buscarPorChave({ nameKey: 'ninguem', realmKey: 'azralon' })).toBeNull();
  });
});
