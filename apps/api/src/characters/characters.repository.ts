import { Injectable } from '@nestjs/common';
import { toCharacterKey, toRealmMatchKey } from '@titan/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Um personagem como as fontes o entregam: nome e realm, sem id nenhum. */
export interface PersonagemDaFonte {
  name: string;
  realm: string;

  /** Token do cliente (`MAGE`), quando a fonte diz. */
  class?: string | null;
}

/** O que sai daqui para a tela. A grafia é a da identidade, não a da fonte. */
export interface CharacterView {
  id: string;
  name: string;
  realm: string;
  nameKey: string;
  realmKey: string;
}

/** Colunas da identidade que a leitura precisa. */
export const characterSelect = {
  id: true,
  name: true,
  realm: true,
  nameKey: true,
  realmKey: true,
} as const;

/**
 * A identidade de personagem, que toda tabela referencia.
 *
 * **Toda coleta chega por nome + realm**, de fontes que não conhecem id nenhum
 * — RCLootCouncil, WarcraftLogs, WoWAudit, roster da Blizzard, colagem do
 * addon. Gravar qualquer coisa sobre uma pessoa passa por aqui: resolve a
 * identidade, ou cria.
 *
 * É por isso que este repositório é o lugar mais perigoso do sistema para um
 * erro de normalização: resolver com a chave errada junta duas pessoas numa
 * identidade só, e o sintoma é o histórico de alguém aparecendo no nome de
 * outro — sem erro, sem log, sem nada.
 */
@Injectable()
export class CharactersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A identidade deste personagem, criando se ainda não existir.
   *
   * As duas chaves são as da Regra 6, e não são intercambiáveis:
   * `toCharacterKey()` **mantém o acento** porque `Shrëwd` e `Shrêwd` são
   * pessoas diferentes; `toRealmMatchKey()` tira o separador porque a Blizzard
   * escreve `Area 52` e o WarcraftLogs escreve `Area52`.
   *
   * A grafia só é atualizada quando vem de fonte melhor — ver `resolverDoRoster`.
   */
  async resolver(personagem: PersonagemDaFonte): Promise<string> {
    const chave = chaveDe(personagem);

    const identidade = await this.prisma.character.upsert({
      where: { nameKey_realmKey: chave },
      create: {
        ...chave,
        name: personagem.name,
        realm: personagem.realm,
        class: personagem.class ?? null,
      },
      // Não sobrescreve a grafia: fonte comum só preenche o que falta. Quem
      // manda na grafia é a Blizzard.
      update: personagem.class ? { class: personagem.class } : {},
      select: { id: true },
    });

    return identidade.id;
  }

  /**
   * A identidade vinda do **roster da Blizzard**, que sobrescreve a grafia.
   *
   * É a fonte que o jogo considera oficial, e é a mesma regra que o
   * `OfficerGrant` já seguia ao gravar a grafia da Blizzard e não a digitada.
   */
  async resolverDoRoster(personagem: PersonagemDaFonte): Promise<string> {
    const chave = chaveDe(personagem);

    const identidade = await this.prisma.character.upsert({
      where: { nameKey_realmKey: chave },
      create: {
        ...chave,
        name: personagem.name,
        realm: personagem.realm,
        class: personagem.class ?? null,
      },
      update: {
        name: personagem.name,
        realm: personagem.realm,
        ...(personagem.class ? { class: personagem.class } : {}),
      },
      select: { id: true },
    });

    return identidade.id;
  }

  /**
   * Resolve uma lista de uma vez, devolvendo id por `nameKey|realmKey`.
   *
   * Existe para o import e para os jobs: eles gravam centenas de linhas, e um
   * `resolver()` por linha seriam centenas de idas ao banco. Cria o que falta em
   * uma única inserção.
   */
  async resolverVarios(personagens: PersonagemDaFonte[]): Promise<Map<string, string>> {
    const porChave = new Map<string, PersonagemDaFonte>();
    for (const p of personagens) porChave.set(indice(chaveDe(p)), p);

    if (porChave.size === 0) return new Map();

    await this.prisma.character.createMany({
      data: [...porChave.values()].map((p) => ({
        ...chaveDe(p),
        name: p.name,
        realm: p.realm,
        class: p.class ?? null,
      })),
      skipDuplicates: true,
    });

    const chaves = [...porChave.values()].map(chaveDe);
    const existentes = await this.prisma.character.findMany({
      where: { OR: chaves },
      select: { id: true, nameKey: true, realmKey: true },
    });

    return new Map(existentes.map((c) => [indice(c), c.id]));
  }

  /** A identidade de um personagem, se já existir. Não cria. */
  async buscar(personagem: PersonagemDaFonte): Promise<CharacterView | null> {
    return this.prisma.character.findUnique({
      where: { nameKey_realmKey: chaveDe(personagem) },
      select: characterSelect,
    });
  }

  /**
   * A identidade já existente, para quem já tem as duas chaves prontas em vez
   * de nome+realm crus. Não cria — mesmo contrato do `buscar()`.
   *
   * O `where` é montado com as DUAS chaves explícitas, nunca `chave` direto:
   * o parâmetro é tipado com só `nameKey`/`realmKey`, mas TS não barra quem
   * passa uma variável mais rica (ex.: o `personagem` de `LootSessionsRepository`,
   * que também carrega `name`/`realm`) — não há excess-property-check em
   * variável repassada, só em literal. O Prisma, esse sim, valida em runtime e
   * rejeita chave extra em `where` composto (`Unknown argument`). Bug real,
   * visto em produção local ao entrar numa sessão de loot.
   */
  async buscarPorChave(chave: {
    nameKey: string;
    realmKey: string;
  }): Promise<CharacterView | null> {
    return this.prisma.character.findUnique({
      where: { nameKey_realmKey: { nameKey: chave.nameKey, realmKey: chave.realmKey } },
      select: characterSelect,
    });
  }

  /**
   * Ids de identidade fora do padrão `cuid()` — TIT-132, backfill de 16/08.
   *
   * `cuid()` é `@default` avaliado em JS, não existe no Postgres, então as 69
   * identidades criadas pelo backfill (que rodou em SQL puro) saíram em uuid.
   * O teste é o hífen: cuid nunca tem, uuid sempre tem — não precisa adivinhar
   * formato.
   */
  async findIdsForaDoPadrao(): Promise<string[]> {
    const linhas = await this.prisma.character.findMany({
      where: { id: { contains: '-' } },
      select: { id: true },
    });
    return linhas.map((l) => l.id);
  }

  /**
   * Troca o id de uma identidade.
   *
   * Os 11 FKs que apontam para `Character.id` são `ON UPDATE CASCADE`
   * (conferido no `pg_constraint`), então este `UPDATE` propaga sozinho para
   * as tabelas filhas — nada a derrubar ou recriar antes.
   */
  async renomearId(idAntigo: string, idNovo: string): Promise<void> {
    await this.prisma.character.update({ where: { id: idAntigo }, data: { id: idNovo } });
  }
}

/** As duas chaves da Regra 6. Nunca uma só, nunca a função trocada. */
export function chaveDe(personagem: { name: string; realm: string }): {
  nameKey: string;
  realmKey: string;
} {
  return {
    nameKey: toCharacterKey(personagem.name),
    realmKey: toRealmMatchKey(personagem.realm),
  };
}

/** A chave composta como string, para indexar `Map`. */
export function indice(chave: { nameKey: string; realmKey: string }): string {
  return `${chave.nameKey}|${chave.realmKey}`;
}
