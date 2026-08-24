import type { Prisma } from '@prisma/client';
import { LOOT_LINE_SOURCES, LOOT_RESPONSE_KINDS, LOOT_RESPONSES } from '@titan/shared';
import { LootLinesService, type LinhaDeEncerramento } from './loot-lines.service';
import type { LootLineFromSession, LootLinesRepository } from './loot-lines.repository';

/** Peça mítica — contexto `6` na posição do `itemContext`. */
const MITICO = 'item:202612::::::::90:250::6:5:9323:7979:6652:1472:8767:1:28:2645:::::';
/** Peça heroica — contexto `5`. */
const HEROICO = 'item:202612::::::::90:250::5:5:9323:7979:6652:1472:8767:1:28:2645:::::';

const ITEM = (over: Partial<LinhaDeEncerramento> = {}): LinhaDeEncerramento => ({
  externalId: 'item-1',
  itemId: 202612,
  itemString: MITICO,
  winnerCharacterId: 'char-fulano',
  looterCharacterId: 'char-ciclano',
  responseOptionSlug: LOOT_RESPONSES.BIS,
  votes: 3,
  councilNote: null,
  playerNote: null,
  awardedAt: new Date('2026-08-15T02:00:00.000Z'),
  awardedByUserId: 'user-1',
  awardedByBattletag: 'Loot#0001',
  ...over,
});

describe('LootLinesService', () => {
  const repo = {
    findSeasons: jest.fn(() =>
      Promise.resolve([
        { id: 17, startedAt: new Date('2026-03-17T00:00:00.000Z') },
        { id: 18, startedAt: new Date('2026-09-01T00:00:00.000Z') },
      ]),
    ),
    findResponseOptions: jest.fn(() =>
      Promise.resolve([
        { slug: LOOT_RESPONSES.BIS, kind: LOOT_RESPONSE_KINDS.PLAYER },
        { slug: LOOT_RESPONSES.UPGRADE, kind: LOOT_RESPONSE_KINDS.PLAYER },
        { slug: LOOT_RESPONSES.BANKING, kind: LOOT_RESPONSE_KINDS.LOOT_MASTER },
        { slug: LOOT_RESPONSES.NOOP, kind: LOOT_RESPONSE_KINDS.SISTEMA },
      ]),
    ),
    upsertDaSessao: jest.fn((linhas: LootLineFromSession[]) => Promise.resolve(linhas.length)),
  };

  let service: LootLinesService;

  /** As linhas que o serviço mandou gravar na última chamada. */
  const gravadas = (): LootLineFromSession[] => {
    const chamada = repo.upsertDaSessao.mock.calls.at(-1);
    if (chamada === undefined) throw new Error('upsertDaSessao não foi chamado');
    return chamada[0];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findSeasons.mockResolvedValue([
      { id: 17, startedAt: new Date('2026-03-17T00:00:00.000Z') },
      { id: 18, startedAt: new Date('2026-09-01T00:00:00.000Z') },
    ]);
    repo.findResponseOptions.mockResolvedValue([
      { slug: LOOT_RESPONSES.BIS, kind: LOOT_RESPONSE_KINDS.PLAYER },
      { slug: LOOT_RESPONSES.UPGRADE, kind: LOOT_RESPONSE_KINDS.PLAYER },
      { slug: LOOT_RESPONSES.BANKING, kind: LOOT_RESPONSE_KINDS.LOOT_MASTER },
      { slug: LOOT_RESPONSES.NOOP, kind: LOOT_RESPONSE_KINDS.SISTEMA },
    ]);
    repo.upsertDaSessao.mockImplementation((linhas: LootLineFromSession[]) =>
      Promise.resolve(linhas.length),
    );
    service = new LootLinesService(repo as unknown as LootLinesRepository);
  });

  it('monta a linha campo a campo: live_session, sem raw, com os campos de sessão preenchidos', async () => {
    await service.gravarDaSessao({
      sessionId: 'sess-1',
      encounterId: 'enc-kazzara',
      itens: [ITEM()],
    });

    expect(gravadas()[0]).toMatchObject({
      source: LOOT_LINE_SOURCES.LIVE_SESSION,
      externalId: 'item-1',
      sessionId: 'sess-1',
      encounterId: 'enc-kazzara',
      awardedByUserId: 'user-1',
      awardedByBattletag: 'Loot#0001',
      rawImportedLine: null,
    });
  });

  it('difficulty vem do itemContext da PEÇA, nunca de um parâmetro de sala', async () => {
    // A issue não recebe "dificuldade da sessão" nenhuma — só o itemString.
    // Se a assinatura um dia ganhar esse parâmetro, este teste continua
    // provando que ele não é o que decide.
    await service.gravarDaSessao({
      sessionId: 'sess-1',
      encounterId: null,
      itens: [ITEM({ itemString: HEROICO })],
    });

    expect(gravadas()[0]?.difficulty).toBe('heroic');
  });

  it('seasonId vem do awardedAt de CADA item, não de um carimbo único do encerramento', async () => {
    // Duas peças da mesma sessão, entregues em momentos diferentes — uma antes
    // e outra depois da virada de season. Usar `closedAt` da sessão carimbaria
    // as duas com a mesma season, e uma delas ficaria errada.
    const antes = ITEM({ externalId: 'item-1', awardedAt: new Date('2026-08-15T02:00:00.000Z') });
    const depois = ITEM({ externalId: 'item-2', awardedAt: new Date('2026-09-02T02:00:00.000Z') });

    await service.gravarDaSessao({
      sessionId: 'sess-1',
      encounterId: null,
      itens: [antes, depois],
    });

    const porExternalId = new Map(gravadas().map((l) => [l.externalId, l.seasonId]));
    expect(porExternalId.get('item-1')).toBe(17);
    expect(porExternalId.get('item-2')).toBe(18);
  });

  it('encounterId é o da SESSÃO, o mesmo para toda peça', async () => {
    await service.gravarDaSessao({
      sessionId: 'sess-1',
      encounterId: 'enc-kazzara',
      itens: [ITEM({ externalId: 'item-1' }), ITEM({ externalId: 'item-2' })],
    });

    expect(gravadas().map((l) => l.encounterId)).toEqual(['enc-kazzara', 'enc-kazzara']);
  });

  it('responseKind é o CONGELADO de agora, resolvido pelo slug do award', async () => {
    await service.gravarDaSessao({
      sessionId: 'sess-1',
      encounterId: null,
      itens: [ITEM({ responseOptionSlug: LOOT_RESPONSES.BANKING })],
    });

    expect(gravadas()[0]).toMatchObject({
      responseOptionSlug: LOOT_RESPONSES.BANKING,
      responseKind: LOOT_RESPONSE_KINDS.LOOT_MASTER,
    });
  });

  it('slug sem kind resolvido é erro de programação, não de dado', async () => {
    await expect(
      service.gravarDaSessao({
        sessionId: 'sess-1',
        encounterId: null,
        itens: [ITEM({ responseOptionSlug: 'nao-existe' })],
      }),
    ).rejects.toThrow(/kind não resolvido/);
  });

  it('repassa o client de transação para o repositório', async () => {
    const tx = { fake: 'tx' } as unknown as Prisma.TransactionClient;

    await service.gravarDaSessao({ sessionId: 'sess-1', encounterId: null, itens: [ITEM()] }, tx);

    expect(repo.upsertDaSessao).toHaveBeenCalledWith(expect.any(Array), tx);
  });

  it('regerar (rodar de novo) manda a MESMA linha para o mesmo externalId — upsert, não duplicata', async () => {
    // Simula a trava real do banco (`@@unique(source, externalId)`): um Map
    // por chave é o que um upsert idempotente produz, e é a garantia por trás
    // da rota de ops que regera o histórico de uma sessão já encerrada.
    const porChave = new Map<string, LootLineFromSession>();
    repo.upsertDaSessao.mockImplementation((linhas: LootLineFromSession[]) => {
      for (const linha of linhas) porChave.set(`${linha.source}|${linha.externalId}`, linha);
      return Promise.resolve(linhas.length);
    });

    const dados = { sessionId: 'sess-1', encounterId: 'enc-kazzara', itens: [ITEM()] };
    await service.gravarDaSessao(dados);
    await service.gravarDaSessao(dados);

    expect(porChave.size).toBe(1);
  });
});
