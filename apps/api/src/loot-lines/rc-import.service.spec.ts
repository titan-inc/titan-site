import { BadRequestException } from '@nestjs/common';
import { LOOT_RESPONSE_KINDS, LOOT_RESPONSES, type LootResponseKind } from '@titan/shared';
import {
  chaveDe,
  indice,
  type CharactersRepository,
  type PersonagemDaFonte,
} from '../characters/characters.repository';
import type { LootLinesRepository, LootLineUpsert } from './loot-lines.repository';
import { RcImportService } from './rc-import.service';

/** Id determinístico a partir da chave, só para o teste comparar. */
const idDoPersonagem = (p: PersonagemDaFonte): string => `char:${indice(chaveDe(p))}`;

/**
 * Os `kind` das opções semeadas, como a tabela real os teria.
 *
 * `NOOP` é `sistema`; `BANKING`/`DISENCHANT`/`NO_INTEREST` são decisão do loot
 * master; o resto é declaração do jogador. Ver `LOOT_RESPONSES` no shared.
 */
const KIND_POR_SLUG: Record<string, LootResponseKind> = {
  [LOOT_RESPONSES.BIS]: LOOT_RESPONSE_KINDS.PLAYER,
  [LOOT_RESPONSES.UPGRADE]: LOOT_RESPONSE_KINDS.PLAYER,
  [LOOT_RESPONSES.MINOR]: LOOT_RESPONSE_KINDS.PLAYER,
  [LOOT_RESPONSES.OFFSPEC]: LOOT_RESPONSE_KINDS.PLAYER,
  [LOOT_RESPONSES.TRANSMOG]: LOOT_RESPONSE_KINDS.PLAYER,
  [LOOT_RESPONSES.PASS]: LOOT_RESPONSE_KINDS.PLAYER,
  [LOOT_RESPONSES.NOOP]: LOOT_RESPONSE_KINDS.SISTEMA,
  [LOOT_RESPONSES.BANKING]: LOOT_RESPONSE_KINDS.LOOT_MASTER,
  [LOOT_RESPONSES.DISENCHANT]: LOOT_RESPONSE_KINDS.LOOT_MASTER,
  [LOOT_RESPONSES.NO_INTEREST]: LOOT_RESPONSE_KINDS.LOOT_MASTER,
};

/**
 * Um registro do export. Nomes fictícios de propósito: o export real tem gente
 * de verdade, e o CLAUDE.md proíbe versionar dado de membro.
 *
 * O `itemString` carrega contexto 5 (RaidHeroic) na posição 12.
 */
const registro = (over: Record<string, unknown> = {}) => ({
  id: '1774483920-3',
  player: 'Fulano-Area52',
  owner: 'Fulano-Area52',
  itemID: 249308,
  itemString: 'item:249308::::::::90:252::5:4:6652:13577:13334:12794',
  response: 'BiS',
  responseID: '1',
  servertime: '1774483920',
  instance: 'The Voidspire-Heroic',
  boss: 'Chimaerus, the Undreamt God',
  class: 'MAGE',
  votes: 2,
  gear1: 'item:249100::::::::90:252::5',
  gear2: '',
  note: '',
  ...over,
});

describe('RcImportService', () => {
  const repo = {
    findEncounters: jest.fn(() =>
      Promise.resolve([{ id: 'enc-chimaerus', name: 'Chimaerus the Undreamt God' }]),
    ),
    findResponseOptions: jest.fn(() =>
      Promise.resolve(
        Object.values(LOOT_RESPONSES).map((slug) => ({ slug, kind: KIND_POR_SLUG[slug] })),
      ),
    ),
    // O `servertime` do registro padrão é 2026-03-25, então cai na season 17.
    findSeasons: jest.fn(() =>
      Promise.resolve([{ id: 17, startedAt: new Date('2026-03-17T15:00:00.000Z') }]),
    ),
    upsertMany: jest.fn((linhas: LootLineUpsert[]) => Promise.resolve(linhas.length)),
    countBySource: jest.fn(() => Promise.resolve(0)),
  };

  const characters = {
    resolverVarios: jest.fn((personagens: PersonagemDaFonte[]) =>
      Promise.resolve(new Map(personagens.map((p) => [indice(chaveDe(p)), idDoPersonagem(p)]))),
    ),
  };

  let service: RcImportService;

  /** As linhas que o serviço mandou gravar. */
  const gravadas = (): LootLineUpsert[] => {
    const chamada = repo.upsertMany.mock.calls[0];
    if (chamada === undefined) throw new Error('upsertMany não foi chamado');
    return chamada[0];
  };

  /**
   * Uma linha específica, já garantida.
   *
   * Existe para o teste falhar dizendo "não gravou essa linha" em vez de passar
   * por vacuidade: `expect(lista[5]).not.toHaveProperty(x)` passa quando o item
   * não existe, e o teste vira enfeite.
   */
  const linha = (indice = 0): LootLineUpsert => {
    const achada = gravadas()[indice];
    if (achada === undefined) throw new Error(`não há linha gravada no índice ${indice}`);
    return achada;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RcImportService(
      repo as unknown as LootLinesRepository,
      characters as unknown as CharactersRepository,
    );
  });

  describe('o que entra e o que não entra', () => {
    it('grava decisão de conselho', async () => {
      const resultado = await service.importar([registro()]);

      expect(resultado.gravados).toBe(1);
      expect(resultado.descartados).toBe(0);
      expect(linha().responseOptionSlug).toBe(LOOT_RESPONSES.BIS);
    });

    it('descarta bonus roll e personal loot sem gravar', async () => {
      // Foram direto para o jogador, sem decisão a registrar. Descarte é
      // resultado esperado, não erro — por isso conta separado.
      const resultado = await service.importar([
        registro({ responseID: 'BONUSROLL', response: 'Bonus Loot' }),
        registro({
          id: '1774483920-4',
          responseID: 'PL',
          response: 'Personal Loot - Non tradeable',
        }),
        registro({ id: '1774483920-5', responseID: 'BONUSROLL', response: 'Bonus de botín' }),
      ]);

      expect(resultado.descartados).toBe(3);
      expect(resultado.gravados).toBe(0);
      expect(gravadas()).toHaveLength(0);
    });

    it('recusa o arquivo INTEIRO quando um rótulo não é conhecido', async () => {
      // Rótulo novo é lacuna, não lixo. Gravar o resto em silêncio esconderia
      // que faltou histórico — e histórico que não entrou ninguém percebe.
      const importar = service.importar([
        registro(),
        registro({ id: '1774483920-9', responseID: '7', response: 'Rótulo Novo' }),
      ]);

      await expect(importar).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.upsertMany).not.toHaveBeenCalled();
    });

    it('lista TODOS os problemas de uma vez, não o primeiro', async () => {
      // Sem isso, corrigir três rótulos novos exige três execuções.
      const importar = service.importar([
        registro({ id: 'a', responseID: '7', response: 'Um' }),
        registro({ id: 'b', responseID: '8', response: 'Dois' }),
      ]);

      await expect(importar).rejects.toMatchObject({
        response: {
          problemas: ['a: resposta não mapeada: 7|um', 'b: resposta não mapeada: 8|dois'],
        },
      });
    });

    it('recusa quando a opção traduzida não existe na tabela', async () => {
      // A tabela é configurável e alguém pode ter desativado — mas apagar é
      // proibido. Se o slug sumiu, gravar quebraria a FK bem mais tarde.
      repo.findResponseOptions.mockResolvedValueOnce([
        { slug: LOOT_RESPONSES.PASS, kind: KIND_POR_SLUG[LOOT_RESPONSES.PASS] },
      ]);

      await expect(service.importar([registro()])).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('dificuldade é da PEÇA, não da sala', () => {
    it('lê o itemContext e ignora o sufixo da instância', async () => {
      // O caso real: farm heroico distribuído já dentro do mítico. O sufixo diz
      // Heroic, o contexto diz mítico, e a peça é mítica — peça mítica tradeável
      // só existe se caiu no mítico.
      await service.importar([
        registro({
          instance: 'The Voidspire-Heroic',
          itemString: 'item:249308::::::::90:252::6:1:13335',
        }),
      ]);

      expect(linha().difficulty).toBe('mythic');
      // O bruto da instância não vira coluna própria — ver `rawImportedLine`.
      expect((linha().rawImportedLine as { instance: string }).instance).toBe(
        'The Voidspire-Heroic',
      );
    });

    it('peça sem contexto de raid fica sem dificuldade, nunca `normal`', async () => {
      const resultado = await service.importar([
        registro({ itemString: 'item:249308::::::::90:252::35:1:13440' }),
      ]);

      expect(linha().difficulty).toBeNull();
      expect(resultado.semDificuldade).toBe(1);
    });
  });

  describe('boss', () => {
    it('casa apesar da pontuação diferente entre as fontes', async () => {
      // `Chimaerus, the Undreamt God` na fonte × `Chimaerus the Undreamt God` no
      // catálogo. Uma vírgula já reprovou uma carga inteira antes.
      const resultado = await service.importar([registro()]);

      expect(linha().encounterId).toBe('enc-chimaerus');
      expect(resultado.bossResolvido).toBe(1);
    });

    it('nome traduzido não casa, e a linha entra assim mesmo', async () => {
      // 22% do histórico. Exigir o vínculo recusaria histórico legítimo. O nome
      // cru não vira coluna própria — o `rawImportedLine` é o único lugar que
      // guarda "Desconhecido", e nenhuma leitura da aplicação passa por ele.
      const resultado = await service.importar([registro({ boss: 'Desconhecido' })]);

      expect(linha().encounterId).toBeNull();
      expect((linha().rawImportedLine as { boss: string }).boss).toBe('Desconhecido');
      expect(resultado.bossNaoResolvido).toBe(1);
    });

    it('nome ambíguo no catálogo vira nulo em vez de escolher um', async () => {
      repo.findEncounters.mockResolvedValueOnce([
        { id: 'enc-1', name: 'Chimaerus the Undreamt God' },
        { id: 'enc-2', name: 'Chimaerus, the Undreamt God' },
      ]);

      await service.importar([registro()]);

      expect(linha().encounterId).toBeNull();
    });
  });

  describe('identidade do personagem', () => {
    it('repassa nome e realm da fonte, sem normalizar', async () => {
      // Quem normaliza agora é o CharactersRepository (toCharacterKey mantém
      // acento, toRealmMatchKey tira separador — Regra 6). Aqui só confere que
      // o import não mexe na grafia antes de mandar resolver a identidade.
      await service.importar([registro({ player: 'Fulano-Area52' })]);

      expect(characters.resolverVarios).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'Fulano', realm: 'Area52' })]),
      );
      expect(linha().winnerCharacterId).toBe(idDoPersonagem({ name: 'Fulano', realm: 'Area52' }));
    });

    it('não mexe no acento do nome ao repassar', async () => {
      // Shrëwd, Shrêwd e Shrèwd são pessoas diferentes, com ranks diferentes —
      // quem preserva isso é o toCharacterKey() do CharactersRepository.
      await service.importar([registro({ player: 'Shrëwd-Azralon' })]);

      expect(characters.resolverVarios).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'Shrëwd', realm: 'Azralon' })]),
      );
      expect(linha().winnerCharacterId).toBe(idDoPersonagem({ name: 'Shrëwd', realm: 'Azralon' }));
    });

    it('recusa registro sem realm em vez de gravar meia identidade', async () => {
      const importar = service.importar([registro({ player: 'Fulano' })]);

      await expect(importar).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('campos que a fonte preenche com vazio', () => {
    it('voto zero vira zero, e voto ausente vira nulo', async () => {
      await service.importar([
        registro({ votes: 0 }),
        registro({ id: '1774483920-4', votes: undefined }),
      ]);

      expect(linha().votes).toBe(0);
      expect(linha(1).votes).toBeNull();
    });

    it('gear vazio entra como veio no registro cru, sem lista própria', async () => {
      // `rawReplacedGear` não existe mais — o gear1/gear2 originais ficam só
      // dentro de `rawImportedLine`, exatamente como a fonte escreveu.
      await service.importar([registro({ gear1: 'item:1', gear2: '' })]);

      expect(linha().rawImportedLine).toMatchObject({ gear1: 'item:1', gear2: '' });
    });

    it('nota vazia vira nulo', async () => {
      await service.importar([registro({ note: '' })]);

      expect(linha().playerNote).toBeNull();
    });
  });

  describe('season da entrega', () => {
    it('grava a season em que a entrega aconteceu', async () => {
      const resultado = await service.importar([registro()]);

      expect(linha().seasonId).toBe(17);
      expect(resultado.semSeason).toBe(0);
    });

    it('entrega anterior a toda season conhecida fica sem season, e entra assim mesmo', async () => {
      // Lacuna, não erro: a linha é histórico legítimo. Chutar a season mais
      // próxima poria loot na season errada sem ninguém perceber.
      const resultado = await service.importar([registro({ servertime: '1700000000' })]);

      expect(linha().seasonId).toBeNull();
      expect(resultado.gravados).toBe(1);
      expect(resultado.semSeason).toBe(1);
    });

    it('sem season nenhuma no banco, importa tudo sem season', async () => {
      // Acontece se o import rodar antes de o job de snapshot passar. O conserto
      // é rederivar depois, não recusar o arquivo.
      repo.findSeasons.mockResolvedValueOnce([]);

      const resultado = await service.importar([registro()]);

      expect(resultado.gravados).toBe(1);
      expect(resultado.semSeason).toBe(1);
    });
  });

  it('a chave de idempotência é o id do RC', async () => {
    await service.importar([registro({ id: '1774483920-7' })]);

    expect(linha().externalId).toBe('1774483920-7');
    expect(linha().source).toBe('import_rc');
  });

  it('o momento vem do servertime, não de date+time', async () => {
    // `date` e `time` são texto no fuso de quem exportou; o epoch não tem
    // ambiguidade.
    await service.importar([registro({ servertime: '1774483920' })]);

    expect(linha().awardedAt).toEqual(new Date(1_774_483_920_000));
  });

  it('guarda o bruto da resposta para o dia em que alguém questionar a tradução', async () => {
    await service.importar([registro({ responseID: '2', response: 'Big' })]);

    expect(linha().responseOptionSlug).toBe(LOOT_RESPONSES.UPGRADE);
    expect(linha().rawImportedLine).toMatchObject({ response: 'Big', responseID: '2' });
  });

  describe('responseKind — congelado no import', () => {
    it('resposta de jogador grava kind player', async () => {
      await service.importar([registro()]);

      expect(linha().responseKind).toBe('player');
    });

    it('banking grava kind loot_master, não player', async () => {
      // É o que distingue "peça entregue a quem pediu" de "peça que foi para o
      // banco" — sem isto quem guarda o banco entraria no histórico de quem
      // recebeu.
      await service.importar([registro({ responseID: '2', response: 'Banking' })]);

      expect(linha().responseOptionSlug).toBe(LOOT_RESPONSES.BANKING);
      expect(linha().responseKind).toBe('loot_master');
    });
  });

  describe('campos que só a sessão ao vivo preenche', () => {
    it('sessionId, quem awardou e a nota do conselho ficam nulos no import', async () => {
      await service.importar([registro()]);

      expect(linha()).toMatchObject({
        sessionId: null,
        awardedByUserId: null,
        awardedByBattletag: null,
        councilNote: null,
      });
    });
  });

  it('guarda o registro inteiro em rawImportedLine, não campos escolhidos', async () => {
    // A TIT-130 trocou os cinco campos de bruto picado (rawInstance, rawBoss,
    // rawResponse, rawResponseId, rawReplacedGear) por um só, com o registro
    // completo — inclusive o id que já é a chave de idempotência.
    const um = registro();
    await service.importar([um]);

    expect(linha().rawImportedLine).toEqual(um);
  });
});
